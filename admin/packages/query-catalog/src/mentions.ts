import type { components } from "@openpost/api-contract";
import type { QueryFunctionContext } from "@tanstack/query-core";
import { openPostWorkspaceKey } from "./keys";
import { openPostQueryPolicy, queryStaleTime } from "./policies";
export interface MentionLookupQueryAPI {
  lookupMentions(
    workspaceId: string,
    accountId: string,
    query: string,
    signal: AbortSignal,
  ): Promise<{
    candidates: components["schemas"]["MentionCandidate"][];
    mode: "accounts" | "exact_company";
  }>;
}
export function mentionLookupQueryOptions(
  api: MentionLookupQueryAPI,
  workspaceId: string,
  accountId: string,
  query: string,
) {
  const normalized = query.trim();
  const queryKey = openPostWorkspaceKey(
    workspaceId,
    "accounts",
    accountId,
    "mention-search",
    normalized,
  );
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId && accountId && normalized.length >= 2),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.lookupMentions(workspaceId, accountId, normalized, signal),
  };
}
