import { getServer, subscribeServer } from "../server";
import { getTokenMutationRevision, subscribeToken } from "../api/token-store";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { NativeTelemetryController } from "./controller";
import { nativeErrorKind, sanitizeNativeProperties } from "./sanitize";
import app from "../../../app.json";

function preferenceKey(server: string) {
  return `openpost.analytics.${bytesToHex(sha256(new TextEncoder().encode(server)))}`;
}

export const nativeTelemetry = new NativeTelemetryController(
  {
    async read(server) {
      const store = await import("expo-secure-store");
      return store.getItemAsync(preferenceKey(server));
    },
    async write(server, choice) {
      const store = await import("expo-secure-store");
      await store.setItemAsync(preferenceKey(server), choice);
    },
  },
  async (config, current) => {
    const [{ default: PostHog, PostHogPersistedProperty }, { Platform }, Device, Application] =
      await Promise.all([
        import("posthog-react-native"),
        import("react-native"),
        import("expo-device"),
        import("expo-application"),
      ]);
    let identified = false;
    let internal = false;
    const client = new PostHog(config.project_token!, {
      host: config.api_host,
      persistence: "memory",
      personProfiles: "identified_only",
      captureAppLifecycleEvents: false,
      enableSessionReplay: false,
      disableSurveys: true,
      capturePushNotificationSubscriptions: false,
      capturePushNotificationOpened: false,
      disableRemoteFeatureFlags: true,
      // Local consent and the explicit error options own capture. Remote project
      // defaults must not silently turn off sanitized native JS failures.
      disableRemoteConfig: true,
      preloadFeatureFlags: false,
      disableGeoip: true,
      flushAt: 10,
      maxQueueSize: 100,
      requestTimeout: 5000,
      customAppProperties: {
        $app_version: Application.nativeApplicationVersion ?? app.expo.version,
        $app_build:
          Application.nativeBuildVersion ??
          String(Platform.OS === "android" ? app.expo.android.versionCode : app.expo.version),
        $os_name: Platform.OS,
        $os_version: String(Platform.Version),
        $device_type: Device.deviceType === Device.DeviceType.TABLET ? "Tablet" : "Mobile",
      },
      errorTracking: {
        autocapture: {
          uncaughtExceptions: true,
          unhandledRejections: true,
          console: false,
          nativeCrashes: false,
        },
        exceptionSteps: { enabled: false },
      },
      before_send(event) {
        if (!event || !event.properties || !current()) return null;
        const properties = sanitizeNativeProperties(event.event, event.properties);
        if (!properties) return null;
        return {
          ...event,
          properties: {
            ...properties,
            surface: "mobile",
            client: "native",
            $os:
              Platform.OS === "ios" ? "iOS" : Platform.OS === "android" ? "Android" : Platform.OS,
            audience: identified ? "authenticated" : "anonymous",
            analytics_mode: "persistent",
            environment: config.environment,
            edition: config.edition,
            version: app.expo.version,
            server_version: config.version ?? "",
            server_revision: config.revision ?? "",
            $internal_or_test_user: internal,
            ...(event.event === "$identify" ? { $set: { $internal_or_test_user: internal } } : {}),
            $geoip_disable: true,
          },
        };
      },
    });
    return {
      identify(id, isInternal) {
        internal = isInternal;
        client.identify(id, { $internal_or_test_user: isInternal });
        identified = true;
      },
      screen: (path) => {
        client.screen(path);
      },
      capture: (name, properties) => {
        // SAFETY: The controller validates these properties against the shared event catalogue.
        client.capture(name, properties as Parameters<typeof client.capture>[1]);
      },
      exception(error, operation) {
        const kind = nativeErrorKind(error);
        const safe = new Error(`Native ${kind}`);
        safe.name = kind;
        if (error instanceof Error) safe.stack = error.stack;
        client.captureException(safe, { operation, error_kind: kind });
      },
      headers: () => ({
        "X-PostHog-Distinct-ID": client.getDistinctId(),
        "X-PostHog-Session-ID": client.getSessionId(),
      }),
      stop() {
        // reset preserves queued SDK events. Explicitly discard them before
        // shutdown so revocation and server changes cannot flush an old queue.
        client.setPersistedProperty(PostHogPersistedProperty.Queue, []);
        void client
          .optOut()
          .then(() => client.shutdown(0))
          .catch(() => {});
      },
    };
  },
);

// Identity-store publication stops old capture synchronously, before React effects.
function bindNativeTelemetryIdentity() {
  const server = getServer()?.baseUrl ?? null;
  nativeTelemetry.bind(server, `${server ?? ""}\u0000${getTokenMutationRevision()}`);
}
subscribeServer(bindNativeTelemetryIdentity);
subscribeToken(bindNativeTelemetryIdentity);
bindNativeTelemetryIdentity();
