import { expect, test } from "bun:test";
import { sanitizeNativeProperties } from "./sanitize";

test("native exceptions retain technical callsites without authored messages or device paths", () => {
  const safe = sanitizeNativeProperties("$exception", {
    $exception_list: [
      {
        type: "TypeError",
        value: "Customer secret email@example.com",
        stacktrace: {
          frames: [
            {
              filename: "file:///private/customer-folder/index.android.bundle?token=private",
              lineno: 4,
              colno: 22,
              function: "secret customer text",
              vars: { token: "private" },
            },
          ],
        },
      },
    ],
    $os: "android",
    url: "https://private.example",
    author: "Customer secret",
    screenshot: "private",
  });
  expect(safe?.$os).toBe("android");
  expect(JSON.stringify(safe)).not.toContain("Customer");
  expect(JSON.stringify(safe)).not.toContain("private");
  expect(safe?.$exception_list).toEqual([
    {
      type: "TypeError",
      value: "Native TypeError",
      mechanism: { type: "generic", handled: true },
      stacktrace: {
        frames: [
          {
            filename: "index.android.bundle",
            lineno: 4,
            colno: 22,
            in_app: true,
          },
        ],
      },
    },
  ]);
});

test("native telemetry rejects automatic touch and log events", () => {
  expect(sanitizeNativeProperties("$autocapture", { text: "Private caption" })).toBeNull();
  expect(sanitizeNativeProperties("Application Opened", {})).toBeNull();
  expect(sanitizeNativeProperties("constructor", {})).toBeNull();
});
