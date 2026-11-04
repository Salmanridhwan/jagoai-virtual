import type { components } from "@openpost/api-contract";
import type { QueryFunctionContext } from "@tanstack/query-core";
import { openPostWorkspaceKey } from "./keys";
import { openPostQueryPolicy, liveQueryStaleTime } from "./policies";

export interface JobStatusQueryAPI {
  getJob(
    workspaceId: string,
    jobId: string,
    signal: AbortSignal,
  ): Promise<components["schemas"]["JobResponse"]>;
}
export function jobStatusQueryOptions(api: JobStatusQueryAPI, workspaceId: string, jobId: string) {
  const queryKey = openPostWorkspaceKey(workspaceId, "jobs", "detail", jobId);
  return {
    ...openPostQueryPolicy(liveQueryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId && jobId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.getJob(workspaceId, jobId, signal),
  };
}
