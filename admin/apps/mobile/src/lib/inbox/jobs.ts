import type { components } from "@openpost/api-contract";
import type { QueryClient } from "@tanstack/query-core";
import {
  jobStatusQueryOptions,
  runWithCallerAbort,
  throwIfAborted,
  createAbortError,
  type JobStatusQueryAPI,
} from "@openpost/query-catalog";

import { inboxAbortScope } from "./abort";

export type InboxJob = components["schemas"]["JobResponse"];
export type InboxJobCheck = {
  outcome: "completed" | "failed" | "running" | "check";
  jobs: InboxJob[];
};
export function jobIsRunning(job: Pick<InboxJob, "status">) {
  return job.status === "pending" || job.status === "processing";
}
function pause(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? createAbortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, 2000);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
/** Bounded foreground observation. Reads every receipt through its canonical cache owner. */
export async function waitForInboxJobs({
  api,
  queryClient,
  workspaceId,
  jobIds,
  signal,
  timeoutMs = 30_000,
}: {
  api: JobStatusQueryAPI;
  queryClient: QueryClient;
  workspaceId: string;
  jobIds: readonly string[];
  signal: AbortSignal;
  timeoutMs?: number;
}): Promise<InboxJobCheck> {
  const scope = inboxAbortScope([signal], timeoutMs);
  const boundedSignal = scope.signal;
  const jobs = new Map<string, InboxJob>();
  try {
    if (!jobIds.length) return { outcome: "check", jobs: [] };
    while (!boundedSignal.aborted) {
      for (const jobId of new Set(jobIds)) {
        if (jobs.has(jobId) && !jobIsRunning(jobs.get(jobId)!)) continue;
        throwIfAborted(boundedSignal);
        const options = jobStatusQueryOptions(api, workspaceId, jobId);
        const job = await runWithCallerAbort(boundedSignal, () =>
          queryClient.fetchQuery({
            ...options,
            staleTime: 0,
            retry: false,
            networkMode: "always",
            queryFn: ({ signal: querySignal }) => {
              const request = inboxAbortScope([querySignal, boundedSignal]);
              return api.getJob(workspaceId, jobId, request.signal).finally(request.dispose);
            },
          }),
        );
        throwIfAborted(boundedSignal);
        jobs.set(jobId, job);
      }
      const values = [...jobs.values()];
      if (values.some((job) => job.status === "failed")) return { outcome: "failed", jobs: values };
      if (values.every((job) => job.status === "completed"))
        return { outcome: "completed", jobs: values };
      if (values.some((job) => !jobIsRunning(job) && job.status !== "completed"))
        return { outcome: "check", jobs: values };
      await pause(boundedSignal);
    }
  } catch (error) {
    throwIfAborted(signal);
    if (!scope.timedOut()) throw error;
  } finally {
    scope.dispose();
  }
  return { outcome: "running", jobs: [...jobs.values()] };
}
