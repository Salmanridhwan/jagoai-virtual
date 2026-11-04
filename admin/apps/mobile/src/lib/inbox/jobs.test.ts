import { createRequire } from "node:module";
import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/query-core";
import { jobStatusQueryOptions, type JobStatusQueryAPI } from "@openpost/query-catalog";
import { waitForInboxJobs, type InboxJob } from "./jobs";
import { refreshInbox } from "./refresh";

const job: InboxJob = {
  id: "collection-job",
  status: "pending",
  type: "messages_sync",
  attempts: 0,
  max_attempts: 3,
  created_at: "2026-10-20T10:00:00Z",
  run_at: "2026-10-20T10:00:00Z",
};
function fixture(status = "completed") {
  const queryClient = new QueryClient();
  const reads: string[] = [];
  const api: JobStatusQueryAPI = {
    async getJob(workspace, id) {
      reads.push(`${workspace}:${id}`);
      return { ...job, id, status };
    },
  };
  return {
    api,
    queryClient,
    reads,
    workspaceId: "workspace",
    signal: new AbortController().signal,
  };
}
test("job observation uses the canonical workspace cache and stops at a provider failure", async () => {
  const f = fixture("failed");
  const result = await waitForInboxJobs({ ...f, jobIds: [job.id] });
  expect(result.outcome).toBe("failed");
  expect(f.reads).toEqual(["workspace:collection-job"]);
  expect(
    f.queryClient.getQueryData(jobStatusQueryOptions(f.api, "workspace", job.id).queryKey),
  ).toMatchObject({ status: "failed" });
  f.queryClient.clear();
});
test("pending collection is bounded and cancellation aborts the active request", async () => {
  const f = fixture("pending");
  expect((await waitForInboxJobs({ ...f, jobIds: [job.id], timeoutMs: 20 })).outcome).toBe(
    "running",
  );
  expect(f.reads).toHaveLength(1);
  const controller = new AbortController();
  let requestAborted = false;
  const pending = waitForInboxJobs({
    ...f,
    signal: controller.signal,
    jobIds: [job.id],
    api: {
      getJob: (_ws, _id, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            requestAborted = true;
            reject(signal.reason);
          });
        }),
    },
  });
  controller.abort();
  await expect(pending).rejects.toBeDefined();
  expect(requestAborted).toBe(true);
  f.queryClient.clear();
});
test("viewer refresh reads stored state without admitting or observing collection jobs", async () => {
  const f = fixture();
  let reloads = 0;
  const result = await refreshInbox({
    ...f,
    canEdit: false,
    queue: async () => {
      throw new Error("forbidden collection write");
    },
    reloadStored: async () => {
      reloads++;
      return "2026-10-20T11:00:00Z";
    },
  });
  expect(reloads).toBe(1);
  expect(f.reads).toEqual([]);
  expect(result).toContain("Stored items refreshed");
  f.queryClient.clear();
});
test("an empty receipt never claims upstream freshness without an advanced success timestamp", async () => {
  const f = fixture();
  const message = await refreshInbox({
    ...f,
    canEdit: true,
    previousSuccess: "2026-10-20T10:00:00Z",
    queue: async () => ({ status: "queued", queued: 0, job_ids: [] }),
    reloadStored: async () => "2026-10-20T10:00:00Z",
  });
  expect(message).toContain("No newer successful collection");
  expect(f.reads).toEqual([]);
  f.queryClient.clear();
});

test("collection and reply observation support React Native's actual AbortController implementation", async () => {
  const nativeRequire = createRequire(import.meta.resolve("react-native/package.json"));
  // Bun aliases the bare package name to its own controller. Load the native implementation.
  const NativeAbortController = nativeRequire(
    "abort-controller/dist/abort-controller.js",
  ).AbortController;
  const browserController = globalThis.AbortController;
  globalThis.AbortController = NativeAbortController;
  const f = fixture();
  try {
    const signal = new NativeAbortController().signal;
    expect((await waitForInboxJobs({ ...f, signal, jobIds: [job.id] })).outcome).toBe("completed");
    expect(
      await refreshInbox({
        ...f,
        signal,
        canEdit: false,
        queue: async () => {
          throw new Error("forbidden write");
        },
        reloadStored: async () => undefined,
      }),
    ).toContain("Stored items refreshed");
  } finally {
    globalThis.AbortController = browserController;
    f.queryClient.clear();
  }
});
