import { api } from "./api/client";
import { mobileQueryTransportRequest } from "./query-api";
import {
  createOpenPostQueryError,
  type MentionLookupQueryAPI,
  type SavedMentionQueryAPI,
} from "@openpost/query-catalog";
export const nativeSavedMentionAPI: SavedMentionQueryAPI = {
  async listSavedMentions(workspaceId, signal) {
    const { data, error, response } = await mobileQueryTransportRequest(signal, (signal) =>
      api().GET("/workspaces/{workspace_id}/mentions", {
        params: { path: { workspace_id: workspaceId } },
        signal,
      }),
    );
    if (error)
      throw createOpenPostQueryError(response.status, error, "Could not load saved mentions");
    return (data ?? []).map((entry) => ({ ...entry, profiles: entry.profiles ?? [] }));
  },
};
export const nativeMentionLookupAPI: MentionLookupQueryAPI = {
  async lookupMentions(_workspaceId, accountId, query, signal) {
    const { data, error, response } = await mobileQueryTransportRequest(signal, (signal) =>
      api().GET("/accounts/{account_id}/mentions", {
        params: { path: { account_id: accountId }, query: { query } },
        signal,
      }),
    );
    if (error || !data)
      throw createOpenPostQueryError(response.status, error, "Could not search mentions");
    return { ...data, candidates: data.candidates ?? [] };
  },
};
