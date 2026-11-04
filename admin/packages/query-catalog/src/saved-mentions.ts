import type { components } from "@openpost/api-contract";
import { openPostWorkspaceKey } from "./keys";
import { openPostQueryPolicy, queryStaleTime } from "./policies";

export type SavedMention = Omit<components["schemas"]["SavedMentionResponse"], "profiles"> & {
  profiles: NonNullable<components["schemas"]["SavedMentionResponse"]["profiles"]>;
};
export interface SavedMentionQueryAPI {
  listSavedMentions(workspaceId: string, signal: AbortSignal): Promise<SavedMention[]>;
}
export const savedMentionQueryKey = (workspaceId: string) =>
  openPostWorkspaceKey(workspaceId, "saved-mentions");

export function savedMentionsQueryOptions(api: SavedMentionQueryAPI, workspaceId: string) {
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey: savedMentionQueryKey(workspaceId),
    enabled: Boolean(workspaceId),
    queryFn: ({ signal }: { signal: AbortSignal }) => api.listSavedMentions(workspaceId, signal),
  };
}
