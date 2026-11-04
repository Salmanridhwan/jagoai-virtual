import type { components } from "@openpost/api-contract";
import type { QueryFunctionContext } from "@tanstack/query-core";
import { openPostWorkspaceKey } from "./keys";
import { openPostQueryPolicy } from "./policies";

export interface XMessagingQueryAPI {
  getReadiness(
    workspaceId: string,
    accountId: string,
    signal: AbortSignal,
  ): Promise<components["schemas"]["Readiness"]>;
}

export const xMessagingQueryKeys = {
  readiness: (workspaceId: string, accountId: string) =>
    openPostWorkspaceKey(workspaceId, "x-messaging", accountId),
};

export function xMessagingReadinessQueryOptions(
  api: XMessagingQueryAPI,
  workspaceId: string,
  accountId: string,
) {
  const queryKey = xMessagingQueryKeys.readiness(workspaceId, accountId);
  return {
    ...openPostQueryPolicy(),
    queryKey,
    enabled: Boolean(workspaceId && accountId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.getReadiness(workspaceId, accountId, signal),
  };
}
