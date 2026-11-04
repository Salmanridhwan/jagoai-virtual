import {
  allowlistedEventProperties,
  containsSensitiveValue,
  type TelemetryEventMap,
  type TelemetryEventName,
} from "@openpost/telemetry/events";

export type NativeAnalyticsChoice = "allow" | "off" | "undecided";
export type NativeTelemetryConfig = {
  enabled: boolean;
  project_token?: string;
  api_host?: string;
  environment: string;
  edition: string;
  version?: string;
  revision?: string;
};
export type NativeTelemetryUser = { id: string; is_admin: boolean } | null;
export interface NativeTelemetryClient {
  identify(id: string, internal: boolean): void;
  screen(path: string): void;
  capture(name: TelemetryEventName, properties: Record<string, unknown>): void;
  exception(error: unknown, operation: string): void;
  headers(): Record<string, string>;
  stop(): void;
}
export interface NativeChoicePersistence {
  read(server: string): Promise<string | null>;
  write(server: string, choice: "allow" | "off"): Promise<void>;
}

// The controller fences asynchronous consent/SDK work against server and actor
// changes. It owns no credentials and never initializes an SDK before consent.
export class NativeTelemetryController {
  private server: string | null = null;
  private identity = "";
  private generation = 0;
  private choice: NativeAnalyticsChoice = "undecided";
  private choiceUpdates = new Map<string, { choice: "allow" | "off"; confirmed: boolean }>();
  private choiceWrite: Promise<void> = Promise.resolve();
  private config: NativeTelemetryConfig | null = null;
  private client: NativeTelemetryClient | null = null;
  private pendingEvents: {
    name: TelemetryEventName;
    properties: Record<string, unknown>;
  }[] = [];
  private user: NativeTelemetryUser = null;
  private pendingExceptions: { error: unknown; operation: string }[] = [];
  private requestedScreen = "/";
  private sentScreen: string | null = null;
  private listeners = new Set<() => void>();

  constructor(
    private readonly persistence: NativeChoicePersistence,
    private readonly createClient: (
      config: NativeTelemetryConfig,
      current: () => boolean,
    ) => Promise<NativeTelemetryClient>,
  ) {}

  getChoice = () => this.choice;
  isAvailable = () =>
    Boolean(this.config?.enabled && this.config.project_token && this.config.api_host);
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish() {
    for (const listener of this.listeners) listener();
  }
  private stop() {
    this.pendingEvents = [];
    this.pendingExceptions = [];
    const client = this.client;
    this.client = null;
    this.sentScreen = null;
    try {
      client?.stop();
    } catch {
      /* Optional telemetry cannot block identity changes. */
    }
  }

  bind(server: string | null, identity: string): void {
    if (this.server === server && this.identity === identity) return;
    this.generation++;
    this.stop();
    this.server = server;
    this.identity = identity;
    this.config = null;
    this.user = null;
    this.choice = "undecided";
    this.publish();
  }

  async configure(config: NativeTelemetryConfig, user: NativeTelemetryUser): Promise<void> {
    const generation = ++this.generation;
    this.stop();
    const server = this.server;
    if (!server) return;
    this.config = config;
    this.user = user && !containsSensitiveValue(user.id) ? user : null;
    let stored: string | null = null;
    try {
      stored = await this.persistence.read(server);
    } catch {
      /* Unreadable consent stays off. */
    }
    if (generation !== this.generation) return;
    const update = this.choiceUpdates.get(server);
    this.choice = update
      ? update.confirmed
        ? update.choice
        : "off"
      : stored === "allow" || stored === "off"
        ? stored
        : "undecided";
    this.publish();
    await this.start(generation);
  }

  async choose(choice: "allow" | "off", expectedServer = this.server): Promise<void> {
    const server = this.server;
    if (!server || server !== expectedServer) return;
    const generation = ++this.generation;
    this.stop();
    // Stop immediately. Failed persistence must never resume capture.
    this.choice = "off";
    const update = { choice, confirmed: false };
    this.choiceUpdates.set(server, update);
    this.publish();
    const write = this.choiceWrite
      .catch(() => {})
      .then(() => this.persistence.write(server, choice));
    this.choiceWrite = write;
    await write;
    // Consent belongs to the server on this device, independently of the actor
    // generation. A stale save cannot confirm a newer pending or failed choice.
    if (this.choiceUpdates.get(server) === update) update.confirmed = true;
    if (generation !== this.generation) return;
    this.choice = choice;
    this.publish();
    await this.start(generation);
  }

  private async start(generation: number): Promise<void> {
    if (!this.config || !this.isAvailable() || this.choice !== "allow") return;
    const current = () => generation === this.generation && this.choice === "allow";
    let client: NativeTelemetryClient | null = null;
    for (let attempt = 0; attempt < 3 && current(); attempt++) {
      try {
        client = await this.createClient(this.config, current);
        break;
      } catch {
        if (attempt < 2 && current())
          await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
    if (!client) return;
    if (!current()) {
      client.stop();
      return;
    }
    const pending = this.pendingEvents.splice(0);
    const exceptions = this.pendingExceptions.splice(0);
    this.stop();
    this.client = client;
    try {
      if (this.user)
        client.identify(this.user.id, this.config.edition === "cloud" && this.user.is_admin);
    } catch {
      // Failed identity binding must not attribute this actor's activity to an
      // anonymous or previous SDK identity. Collection stays optional.
      this.stop();
      return;
    }
    for (const event of pending) {
      try {
        client.capture(event.name, event.properties);
      } catch {
        /* Optional capture. */
      }
    }
    for (const exception of exceptions) this.exception(exception.error, exception.operation);
    this.screen(this.requestedScreen);
  }

  screen(path: string): void {
    // Expo route segments retain [id] placeholders. Concrete paths never enter here.
    if (
      !/^\/(?:\([a-z-]+\)\/)?(?:[a-z-]+|\[id\])(?:\/(?:[a-z-]+|\[id\]))*$/.test(path) &&
      path !== "/"
    )
      return;
    this.requestedScreen = path;
    if (!this.client || this.sentScreen === path) return;
    try {
      this.client.screen(path);
      this.sentScreen = path;
    } catch {
      /* Optional screen tracking. */
    }
  }

  capture<Name extends TelemetryEventName>(name: Name, properties: TelemetryEventMap[Name]): void {
    const safe = allowlistedEventProperties(name, properties);
    if (!safe || this.choice !== "allow") return;
    if (!this.client && this.isAvailable() && this.pendingEvents.length < 100) {
      this.pendingEvents.push({ name, properties: safe });
      return;
    }
    if (safe) {
      try {
        this.client?.capture(name, safe);
      } catch {
        /* Optional telemetry never changes the product outcome. */
      }
    }
  }
  exception(error: unknown, operation: string): void {
    if (this.choice !== "allow") return;
    if (!this.client && this.isAvailable() && this.pendingExceptions.length < 100) {
      this.pendingExceptions.push({ error, operation });
      return;
    }
    try {
      this.client?.exception(error, operation);
    } catch {
      /* Never report a telemetry failure through itself. */
    }
  }
  headers(server: string): Record<string, string> {
    try {
      return server === this.server ? (this.client?.headers() ?? {}) : {};
    } catch {
      return {};
    }
  }
}
