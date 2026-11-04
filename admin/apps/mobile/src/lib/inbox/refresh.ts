import type { components } from "@openpost/api-contract";
import type { QueryClient } from "@tanstack/query-core";
import { throwIfAborted, type JobStatusQueryAPI } from "@openpost/query-catalog";
import { inboxAbortScope } from "./abort";
import { waitForInboxJobs } from "./jobs";

type RefreshOutcome = components["schemas"]["RefreshCapabilityOutcome"];
export function lastSuccessfulSync(
  states: readonly { social_account_id: string; last_success_at?: string }[] | null | undefined,
  accountId = "",
) {
  return states
    ?.filter((state) => !accountId || state.social_account_id === accountId)
    .map((state) => state.last_success_at)
    .filter(
      (value): value is string =>
        !!value && !value.startsWith("0001-") && Number.isFinite(Date.parse(value)),
    )
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}
/** Pull-to-refresh owns collection admission; ordinary page reads remain stored-only. */
export async function refreshInbox({
  canEdit,
  queue,
  reloadStored,
  previousSuccess,
  api,
  queryClient,
  workspaceId,
  signal,
}: {
  canEdit: boolean;
  queue(signal: AbortSignal): Promise<RefreshOutcome>;
  reloadStored(): Promise<string | undefined>;
  previousSuccess?: string;
  api: JobStatusQueryAPI;
  queryClient: QueryClient;
  workspaceId: string;
  signal: AbortSignal;
}): Promise<string> {
  throwIfAborted(signal);
  if (!canEdit) {
    await reloadStored();
    throwIfAborted(signal);
    return "Stored items refreshed. Your Workspace role cannot request upstream collection.";
  }
  const deadline = inboxAbortScope([signal], 30_000);
  const boundedSignal = deadline.signal;
  try {
    const receipt = await queue(boundedSignal);
    throwIfAborted(boundedSignal);
    const jobs = receipt.job_ids ?? [];
    const result =
      receipt.status === "queued" && jobs.length
        ? await waitForInboxJobs({
            api,
            queryClient,
            workspaceId,
            jobIds: jobs,
            signal: boundedSignal,
          })
        : undefined;
    throwIfAborted(signal);
    const latestSuccess = await reloadStored();
    throwIfAborted(signal);
    if (receipt.status === "failed" || result?.outcome === "failed")
      return `Collection failed. ${result?.jobs.find((job) => job.status === "failed")?.last_error || receipt.error_code || "Check account settings and try again."} Stored items remain available.`;
    if (receipt.status === "unavailable")
      return "Collection is unavailable for these accounts. Showing stored items.";
    if (result?.outcome === "running")
      return "Collection is still running. Showing stored items while the networks respond.";
    if (result?.outcome === "check")
      return "Collection needs checking. Showing stored items; upstream completion is unconfirmed.";
    if (
      latestSuccess &&
      (!previousSuccess || Date.parse(latestSuccess) > Date.parse(previousSuccess))
    )
      return "A successful collection was recorded. Networks may deliver updates later.";
    return "Stored items refreshed. No newer successful collection has been confirmed; networks may deliver updates later.";
  } catch (error) {
    throwIfAborted(signal);
    if (deadline.timedOut())
      return "Collection may still be running. Upstream completion is unconfirmed; showing stored items.";
    throw error;
  } finally {
    deadline.dispose();
  }
}
