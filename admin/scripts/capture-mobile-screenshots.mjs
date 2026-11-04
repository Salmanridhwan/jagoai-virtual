import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { writeFile, mkdir, readdir, stat, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin")
  throw new Error("Native iOS screenshots require macOS and Xcode.");
const root = fileURLToPath(new URL("../", import.meta.url));
const mobile = resolve(root, "apps/mobile");
const output = resolve(mobile, "artifacts/screenshots");
const port = "8081";
const maestro = process.env.MAESTRO_BIN ?? "maestro";
const appBundleId = "com.openpost.app";
const metroConfig = resolve(root, "apps/mobile/tests/screenshots/metro.config.cjs");
let simulator;
let metro;
let activeChild;
const env = {
  ...process.env,
  EXPO_OVERRIDE_METRO_CONFIG: metroConfig,
  CI: "1",
  MAESTRO_CLI_NO_ANALYTICS: "1",
};
function cleanup() {
  activeChild?.kill("SIGTERM");
  metro?.kill("SIGTERM");
  if (simulator) {
    spawnSync("xcrun", ["simctl", "shutdown", simulator]);
    spawnSync("xcrun", ["simctl", "delete", simulator]);
    simulator = undefined;
  }
}
process.once("SIGINT", () => {
  cleanup();
  process.exit(130);
});
process.once("SIGTERM", () => {
  cleanup();
  process.exit(143);
});

function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, { cwd: root, encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${executable} failed: ${result.stderr ?? result.status}`);
  return result.stdout?.trim();
}

async function run(executable, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, stdio: "inherit", ...options });
    activeChild = child;
    child.on("error", reject);
    child.on("exit", (code) => {
      activeChild = undefined;
      code === 0 ? resolve() : reject(new Error(`${executable} exited ${code}`));
    });
  });
}

try {
  await mkdir(output, { recursive: true });
  command(maestro, ["--version"]);
  simulator = command("xcrun", [
    "simctl",
    "create",
    "OpenPost screenshots",
    "com.apple.CoreSimulator.SimDeviceType.iPhone-17",
    "com.apple.CoreSimulator.SimRuntime.iOS-26-2",
  ]);
  command("xcrun", ["simctl", "boot", simulator]);
  command("xcrun", ["simctl", "bootstatus", simulator, "-b"]);
  command("xcrun", ["simctl", "ui", simulator, "content_size", "large"]);
  overrideStatusBar(simulator);
  try {
    const existing = await fetch(`http://localhost:${port}/status`, {
      signal: AbortSignal.timeout(1000),
    });
    if (existing.ok)
      throw new Error(`Stop the existing Metro server on port ${port} before capturing.`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Stop the existing")) throw error;
  }
  await writeFile(resolve(output, "entry.js"), 'require("../../tests/screenshots/entry.js");\n');
  metro = spawn("bunx", ["expo", "start", "--localhost", "--port", port], {
    cwd: mobile,
    env,
    stdio: "inherit",
  });
  metro.on("error", (error) => console.error(error));
  const deadline = Date.now() + 60000;
  while (true) {
    if (metro.exitCode !== null) throw new Error("Metro stopped before it became ready.");
    try {
      const status = await fetch(`http://localhost:${port}/status`, {
        signal: AbortSignal.timeout(1000),
      });
      if (status.ok) break;
    } catch {
      /* Metro starts asynchronously. */
    }
    if (Date.now() >= deadline) throw new Error("Metro did not become ready.");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (process.env.OPENPOST_SCREENSHOT_APP) {
    command("xcrun", ["simctl", "install", simulator, process.env.OPENPOST_SCREENSHOT_APP]);
  } else {
    await run("bun", ["run", "ios", "--", "--device", simulator, "--no-bundler"], {
      cwd: mobile,
      env,
    });
  }
  for (const scheme of ["light", "dark"]) {
    command("xcrun", ["simctl", "ui", simulator, "appearance", scheme]);
    const startedAt = Date.now();
    for (const flow of ["gallery", "inbox"])
      await runFlow(flow, { SCHEME: scheme }, scheme, "large");
    await collectScreenshots(output, scheme, startedAt);
  }
  command("xcrun", ["simctl", "ui", simulator, "appearance", "light"]);
  command("xcrun", ["simctl", "ui", simulator, "content_size", "accessibility-large"]);
  const largeStartedAt = Date.now();
  await runFlow(
    "inbox-large-recovery",
    { SCHEME: "light", CASE_ID: String(largeStartedAt) },
    "light",
    "accessibility-large",
  );
  await collectScreenshots(output, "light", largeStartedAt);
  command("xcrun", ["simctl", "ui", simulator, "content_size", "large"]);
  await run("bun", ["scripts/render-mobile-gallery.mjs", output, "--inbox"]);
  await run("bun", ["scripts/render-mobile-gallery.mjs", output]);
} finally {
  cleanup();
}

// Maestro keeps relative captures within each run's artifact directory. Copy
// only fresh captures into the stable gallery input paths after a successful run.
async function collectScreenshots(directory, scheme, startedAt) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await collectScreenshots(file, scheme, startedAt);
    } else if (entry.isFile() && entry.name.endsWith(`-${scheme}.png`)) {
      const target = resolve(output, entry.name);
      if (file !== target && (await stat(file)).mtimeMs >= startedAt) await copyFile(file, target);
    }
  }
}

// Fixture data resets with each app relaunch, but local admissions (sent chat
// messages, read states) persist in the app data container and leak into later
// captures, such as the second scheme's chat showing the first scheme's queued
// message a second time. Terminate the app and clear its data container so
// every flow starts from seeded sample data only.
function resetAppData(device) {
  spawnSync("xcrun", ["simctl", "terminate", device, appBundleId]); // The app may not be running yet.
  const container = command("xcrun", ["simctl", "get_app_container", device, appBundleId, "data"]);
  for (const folder of ["Library", "Documents", "tmp"])
    rmSync(resolve(container, folder), { recursive: true, force: true });
}

function overrideStatusBar(device) {
  command("xcrun", [
    "simctl",
    "status_bar",
    device,
    "override",
    "--time",
    "9:41",
    "--batteryState",
    "discharging",
    "--batteryLevel",
    "100",
    "--wifiBars",
    "3",
    "--cellularBars",
    "4",
  ]);
}

// The Apple Intelligence takeover page and iOS 26 sim SpringBoard restarts can
// interrupt an invocation. Boot the device again and run the same flow once
// more so a transient system event does not fail the whole capture.
async function restoreSimulator(device) {
  spawnSync("xcrun", ["simctl", "shutdown", device]); // The device may already be down.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const booted = spawnSync("xcrun", ["simctl", "boot", device]);
    if (booted.status === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
  command("xcrun", ["simctl", "bootstatus", device, "-b"]);
  overrideStatusBar(device);
}

async function runFlow(flow, extraEnv, scheme, contentSize) {
  const attempt = () =>
    run(
      maestro,
      [
        "--udid",
        simulator,
        "test",
        "--test-output-dir",
        output,
        ...Object.entries(extraEnv).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
        `apps/mobile/tests/screenshots/${flow}.yaml`,
      ],
      { env },
    );

  resetAppData(simulator);
  try {
    await attempt();
  } catch (error) {
    console.warn(`Retrying ${flow} after a simulator restore (${error.message}).`);
    await restoreSimulator(simulator);
    command("xcrun", ["simctl", "ui", simulator, "appearance", scheme]);
    command("xcrun", ["simctl", "ui", simulator, "content_size", contentSize]);
    resetAppData(simulator);
    await attempt();
  }
}
