import { expect, test } from "bun:test";
import { NativeTelemetryController, type NativeTelemetryClient } from "./controller";

function fixture(writeError?: Error) {
  const calls: string[] = [];
  const choices = new Map<string, string>();
  const client: NativeTelemetryClient = {
    identify: (id) => {
      calls.push(`identify:${id}`);
    },
    screen: (path) => {
      calls.push(`screen:${path}`);
    },
    capture: (name) => {
      calls.push(name);
    },
    exception: () => {},
    headers: () => ({ "X-PostHog-Distinct-ID": "opaque-user" }),
    stop: () => {
      calls.push("stop");
    },
  };
  const subject = new NativeTelemetryController(
    {
      read: async (server) => choices.get(server) ?? null,
      write: async (server, choice) => {
        if (writeError) throw writeError;
        choices.set(server, choice);
      },
    },
    async () => {
      calls.push("create");
      return client;
    },
  );
  subject.bind("server-a", "actor-a");
  return { subject, calls, choices };
}
const config = {
  enabled: true,
  project_token: "phc_fixture",
  api_host: "https://example.test",
  environment: "test",
  edition: "cloud",
};

test("failed consent persistence stays off across foreground reconfiguration", async () => {
  const { subject, choices, calls } = fixture(new Error("Secure storage unavailable"));
  choices.set("server-a", "allow");
  await subject.configure(config, { id: "opaque-user", is_admin: false });
  await expect(subject.choose("off")).rejects.toThrow("Secure storage unavailable");
  await subject.configure(config, { id: "opaque-user", is_admin: false });
  const count = calls.length;
  subject.capture("publication publish requested", { account_count: 1, is_thread: false });
  expect(subject.getChoice()).toBe("off");
  expect(subject.headers("server-a")).toEqual({});
  expect(calls.length).toBe(count);
});

test("overlapping consent saves retain the last choice after an actor change", async () => {
  let stored = "off";
  let started!: () => void;
  let finish!: () => void;
  const writeStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const allowWrite = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const subject = new NativeTelemetryController(
    {
      read: async () => stored,
      write: async (_server, choice) => {
        if (choice === "allow") {
          started();
          await allowWrite;
        }
        stored = choice;
      },
    },
    async () => ({
      identify() {},
      screen() {},
      capture() {},
      exception() {},
      stop() {},
      headers: () => ({ "X-PostHog-Distinct-ID": "anonymous-sdk-id" }),
    }),
  );
  subject.bind("server-a", "actor-a");
  await subject.configure(config, null);
  const allowing = subject.choose("allow");
  await writeStarted;
  const declining = subject.choose("off");
  finish();
  await Promise.all([allowing, declining]);
  subject.bind("server-a", "actor-b");
  await subject.configure(config, null);
  expect(subject.getChoice()).toBe("off");
  expect(subject.headers("server-a")).toEqual({});
});

test("successful consent saved during an actor change applies on reconfiguration", async () => {
  let stored = "off";
  let started!: () => void;
  let finish!: () => void;
  const writeStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const writeFinished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const identified: string[] = [];
  const subject = new NativeTelemetryController(
    {
      read: async () => stored,
      write: async (_server, choice) => {
        started();
        await writeFinished;
        stored = choice;
      },
    },
    async () => ({
      identify(id) {
        identified.push(id);
      },
      screen() {},
      capture() {},
      exception() {},
      stop() {},
      headers: () => ({ "X-PostHog-Distinct-ID": "current-sdk-id" }),
    }),
  );
  subject.bind("server-a", "actor-a");
  await subject.configure(config, { id: "actor-a", is_admin: false });
  const allowing = subject.choose("allow");
  await writeStarted;
  subject.bind("server-a", "actor-b");
  await subject.configure(config, { id: "actor-b", is_admin: false });
  finish();
  await allowing;
  expect(identified).toEqual([]);
  await subject.configure(config, { id: "actor-b", is_admin: false });
  expect(subject.getChoice()).toBe("allow");
  expect(identified).toEqual(["actor-b"]);
  expect(subject.headers("server-a")).toEqual({ "X-PostHog-Distinct-ID": "current-sdk-id" });
});

test("failed native identification stops collection and request correlation", async () => {
  let captured = 0;
  let stopped = 0;
  const subject = new NativeTelemetryController(
    { read: async () => "allow", write: async () => {} },
    async () => ({
      identify() {
        throw new Error("SDK identification failed");
      },
      screen() {
        captured++;
      },
      capture() {
        captured++;
      },
      exception() {
        captured++;
      },
      headers: () => ({ "X-PostHog-Distinct-ID": "anonymous-sdk-id" }),
      stop() {
        stopped++;
      },
    }),
  );
  subject.bind("server-a", "actor-a");
  await subject.configure(config, { id: "opaque-user", is_admin: false });
  subject.capture("publication publish requested", { account_count: 1, is_thread: false });
  expect(captured).toBe(0);
  expect(subject.headers("server-a")).toEqual({});
  expect(stopped).toBe(1);
});

test("native telemetry starts only after consent and clears capture on revocation", async () => {
  const { subject, calls } = fixture();
  subject.screen("/publications/[id]");
  await subject.configure(config, { id: "opaque-user", is_admin: false });
  subject.capture("publication publish requested", {
    account_count: 1,
    is_thread: false,
  });
  expect(calls).toEqual([]);
  await subject.choose("allow");
  expect(calls).toEqual(["create", "identify:opaque-user", "screen:/publications/[id]"]);
  subject.capture("publication publish requested", {
    account_count: 1,
    is_thread: false,
  });
  expect(calls.at(-1)).toBe("publication publish requested");
  await subject.choose("off");
  const count = calls.length;
  subject.capture("publication publish requested", {
    account_count: 1,
    is_thread: false,
  });
  expect(calls.length).toBe(count);
  expect(subject.headers("server-a")).toEqual({});
});

test("server and actor changes stop native correlation immediately and isolate consent", async () => {
  const { subject, calls } = fixture();
  await subject.configure(config, { id: "opaque-user", is_admin: false });
  await subject.choose("allow");
  expect(subject.headers("server-b")).toEqual({});
  subject.bind("server-b", "actor-b");
  expect(calls.at(-1)).toBe("stop");
  expect(subject.headers("server-a")).toEqual({});
  await subject.configure(config, { id: "other-user", is_admin: false });
  expect(subject.getChoice()).toBe("undecided");
});

test("a late native SDK initialization cannot cross an actor change", async () => {
  let finish!: (client: NativeTelemetryClient) => void;
  let stopped = 0;
  let captured = 0;
  const subject = new NativeTelemetryController(
    { read: async () => "allow", write: async () => {} },
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  subject.bind("server-a", "actor-a");
  const pending = subject.configure(config, null);
  await Promise.resolve();
  subject.capture("publication publish requested", {
    account_count: 1,
    is_thread: false,
  });
  subject.bind("server-a", "actor-b");
  finish({
    identify() {},
    screen() {},
    capture() {
      captured++;
    },
    exception() {},
    headers: () => ({ stale: "true" }),
    stop() {
      stopped++;
    },
  });
  await pending;
  expect(stopped).toBe(1);
  expect(captured).toBe(0);
  expect(subject.headers("server-a")).toEqual({});
});

test("a consent dialog from a previous server cannot grant the current server", async () => {
  const { subject, calls, choices } = fixture();
  await subject.configure(config, null);
  subject.bind("server-b", "actor-b");
  await subject.configure(config, null);
  await subject.choose("allow", "server-a");
  expect(subject.getChoice()).toBe("undecided");
  expect(choices.has("server-b")).toBe(false);
  expect(calls).toEqual([]);
});

test("consented native errors wait for SDK initialization and are delivered once", async () => {
  let finish!: (client: NativeTelemetryClient) => void;
  let started!: () => void;
  const sdkStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  let exceptions = 0;
  const subject = new NativeTelemetryController(
    { read: async () => null, write: async () => {} },
    () =>
      new Promise((resolve) => {
        finish = resolve;
        started();
      }),
  );
  subject.bind("server-a", "actor-a");
  await subject.configure(config, null);
  const pending = subject.choose("allow", "server-a");
  await sdkStarted;
  subject.exception(new Error("private failure"), "/publications/[id]/edit");
  finish({
    identify() {},
    screen() {},
    capture() {},
    exception() {
      exceptions++;
    },
    headers: () => ({}),
    stop() {},
  });
  await pending;
  expect(exceptions).toBe(1);
});
