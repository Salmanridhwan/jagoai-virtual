import { eventPropertyAllowlists } from "@openpost/telemetry/events";

const common = new Set([
  "$device_type",
  "$os",
  "$os_name",
  "$os_version",
  "$app_version",
  "$app_build",
  "$app_namespace",
  "$lib",
  "$lib_version",
  "$session_id",
  "$window_id",
  "$device_id",
  "$is_identified",
  "$process_person_profile",
  "$geoip_disable",
  "$screen_name",
  "$anon_distinct_id",
  "surface",
  "environment",
  "edition",
  "version",
  "revision",
  "client",
  "audience",
  "$internal_or_test_user",
  "error_kind",
  "operation",
  "error_boundary",
]);
const protocols = new Set(["$screen", "$identify", "$exception"]);
const exceptionKinds = new Set([
  "Error",
  "TypeError",
  "ReferenceError",
  "RangeError",
  "SyntaxError",
  "AbortError",
  "NetworkError",
]);

export function nativeErrorKind(error: unknown): string {
  return error instanceof Error && exceptionKinds.has(error.name) ? error.name : "Error";
}

// Native error payloads retain technical locations without messages, source
// excerpts, screenshots, device paths or authored content.
export function sanitizeNativeProperties(
  event: string,
  properties: Record<string, unknown>,
): Record<string, unknown> | null {
  const fields = Object.hasOwn(eventPropertyAllowlists, event)
    ? eventPropertyAllowlists[event as keyof typeof eventPropertyAllowlists]
    : undefined;
  if (!fields && !protocols.has(event)) return null;
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (
      (common.has(key) || fields?.includes(key)) &&
      (typeof value === "boolean" || typeof value === "number" || typeof value === "string")
    ) {
      if (
        typeof value === "string" &&
        /(?:https?:|file:|\bBearer\s|@|(?:token|password|secret)=)/i.test(value)
      )
        continue;
      safe[key] = value;
    }
  }
  if (event === "$identify")
    safe.$set = {
      $internal_or_test_user: properties.$internal_or_test_user === true,
    };
  if (event === "$exception" && Array.isArray(properties.$exception_list)) {
    safe.$exception_list = properties.$exception_list.slice(0, 1).map((entry) => {
      const source = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
      const kind = exceptionKinds.has(String(source.type)) ? String(source.type) : "Error";
      const trace =
        source.stacktrace && typeof source.stacktrace === "object"
          ? (source.stacktrace as Record<string, unknown>)
          : {};
      const frames = Array.isArray(trace.frames) ? trace.frames : [];
      return {
        type: kind,
        value: `Native ${kind}`,
        mechanism: {
          type: "generic",
          handled:
            source.mechanism &&
            typeof source.mechanism === "object" &&
            "handled" in source.mechanism
              ? source.mechanism.handled !== false
              : true,
        },
        stacktrace: {
          frames: frames.slice(-24).map((frame) => {
            const f = frame && typeof frame === "object" ? (frame as Record<string, unknown>) : {};
            const filename = String(f.filename ?? "")
              .split(/[?#]/)[0]
              .split("/")
              .at(-1);
            return {
              filename:
                filename &&
                /^(?:index\.(?:android|ios)\.bundle|main\.jsbundle|[a-zA-Z0-9_-]+\.js)$/.test(
                  filename,
                )
                  ? filename
                  : "app.bundle",
              lineno: typeof f.lineno === "number" ? f.lineno : undefined,
              colno: typeof f.colno === "number" ? f.colno : undefined,
              in_app: true,
            };
          }),
        },
      };
    });
  }
  return safe;
}
