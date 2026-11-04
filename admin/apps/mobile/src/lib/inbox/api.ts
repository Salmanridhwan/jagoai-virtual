import type { components } from "@openpost/api-contract";
import type {
  FeatureQueryAPI,
  InboxQueryAPI,
  MediaQueryAPI,
  InboxSummaryQueryAPI,
  InboxView,
  JobStatusQueryAPI,
} from "@openpost/query-catalog";
import { createOpenPostQueryError } from "@openpost/query-catalog";
import {
  api,
  apiRequestIdentityIsCurrent,
  captureApiRequestIdentity,
  settleApiUnauthorized,
} from "../api/client";
import { requireInboxConnection } from "./connection";
import { mobileQueryTransportRequest } from "../query-api";

export type Conversation = components["schemas"]["Conversation"];
export type DirectMessage = components["schemas"]["DirectMessage"];
export type MessagePage = components["schemas"]["MessagePage"];
export type Comment = components["schemas"]["EngagementItem"];
export type { InboxView } from "@openpost/query-catalog";

async function result<T>(
  request: Promise<{ data?: T | null; error?: unknown; response: Response }>,
  identity = captureApiRequestIdentity(),
): Promise<T> {
  const response = await request;
  await settleApiUnauthorized(identity, response.response);
  if (!apiRequestIdentityIsCurrent(identity)) throw new Error("The signed-in Workspace changed.");
  if (!response.response.ok || response.error)
    throw createOpenPostQueryError(
      response.response.status,
      response.error,
      "Could not update Inbox",
    );
  if (response.data === undefined || response.data === null)
    throw new Error("The server returned an empty response.");
  return response.data;
}

export const mobileInboxAPI: InboxQueryAPI &
  FeatureQueryAPI &
  InboxSummaryQueryAPI &
  JobStatusQueryAPI = {
  async getJob(_workspaceId, jobId, signal) {
    return result(
      mobileQueryTransportRequest(signal, (signal) =>
        api().GET("/jobs/{id}", { signal, params: { path: { id: jobId } } }),
      ),
    );
  },
  async getEngagement(workspaceId, itemId, signal) {
    return result(
      mobileQueryTransportRequest(signal, (signal) =>
        api().GET("/engagement/{item_id}", {
          signal,
          params: { path: { item_id: itemId }, query: { workspace_id: workspaceId } },
        }),
      ),
    );
  },
  async getInboxSummary(workspaceId, signal) {
    return result(
      mobileQueryTransportRequest(signal, (signal) =>
        api().GET("/inbox/summary", { signal, params: { query: { workspace_id: workspaceId } } }),
      ),
    );
  },
  async listConversations(workspaceId, filters, cursor, signal) {
    return listConversations(workspaceId, filters, cursor, signal);
  },
  async listMessages(workspaceId, conversationId, filters, cursor, signal) {
    return listConversationMessages(workspaceId, conversationId, filters.limit, cursor, signal);
  },
  async listEngagement(workspaceId, filters, cursor, signal) {
    return result(
      mobileQueryTransportRequest(signal, (signal) =>
        api().GET("/engagement", {
          signal,
          params: {
            query: {
              workspace_id: workspaceId,
              platform: filters.platform || undefined,
              account_id: filters.accountId || undefined,
              publication_id: filters.publicationId || undefined,
              kind: filters.kind,
              unread_only: filters.unreadOnly,
              archived: filters.archived,
              limit: filters.limit,
              cursor: cursor || undefined,
            },
          },
        }),
      ),
    );
  },
  async listPublications(workspaceId, filters, cursor, signal) {
    const response = await mobileQueryTransportRequest(signal, (signal) =>
      api().GET("/publications", {
        signal,
        params: {
          query: {
            workspace_id: workspaceId,
            search: filters.search,
            cursor: cursor || undefined,
            limit: filters.limit,
          },
        },
      }),
    );
    if (!response.data || response.error)
      throw createOpenPostQueryError(
        response.response.status,
        response.error,
        "Could not load post context",
      );
    return {
      items: response.data,
      nextCursor: response.response.headers.get("X-Next-Cursor") ?? "",
    };
  },
  async listAccountFeatures(workspaceId, accountIds, signal) {
    return (
      (await result(
        mobileQueryTransportRequest(signal, (signal) =>
          api().GET("/account-features", {
            signal,
            params: { query: { workspace_id: workspaceId, account_ids: accountIds.join(",") } },
          }),
        ),
      )) ?? []
    );
  },
};

function listConversations(
  workspaceId: string,
  filters: {
    accountId?: string;
    archived?: boolean;
    unreadOnly?: boolean;
    search?: string;
    limit?: number;
  },
  cursor: string,
  signal: AbortSignal,
) {
  return result(
    mobileQueryTransportRequest(signal, (signal) =>
      api().GET("/messages", {
        signal,
        params: {
          query: {
            workspace_id: workspaceId,
            account_id: filters.accountId || undefined,
            archived: filters.archived ?? false,
            unread_only: filters.unreadOnly ?? false,
            search: filters.search?.trim() ?? "",
            limit: filters.limit ?? 50,
            cursor: cursor || undefined,
          },
        },
      }),
    ),
  );
}

export const nativeInboxTransport = {
  async inboxChanges(workspaceId: string, cursor: string, signal: AbortSignal) {
    const page = await result(
      mobileQueryTransportRequest(signal, (signal) =>
        api().GET("/inbox/changes", {
          signal,
          params: {
            query: { workspace_id: workspaceId, cursor: cursor || undefined, wait_seconds: 25 },
          },
        }),
      ),
    );
    return { ...page, changes: page.changes ?? [] };
  },
  async inboxActivity(
    workspaceId: string,
    activity: { clientId: string; view: InboxView; conversationId?: string },
    signal: AbortSignal,
  ): Promise<void> {
    const identity = captureApiRequestIdentity();
    const response = await api().POST("/inbox/activity", {
      signal,
      body: {
        workspace_id: workspaceId,
        client_id: activity.clientId,
        view: activity.view,
        conversation_id: activity.conversationId,
      },
    });
    await settleApiUnauthorized(identity, response.response);
    if (!response.response.ok)
      throw createOpenPostQueryError(
        response.response.status,
        response.error,
        "Could not update Inbox activity",
      );
  },
};

export async function sendMessage(
  workspaceId: string,
  conversationId: string,
  message: string,
  clientOperationId: string,
): Promise<DirectMessage> {
  requireInboxConnection();
  const body = { workspace_id: workspaceId, message, client_operation_id: clientOperationId };
  return result(
    api().POST("/messages/{conversation_id}/send", {
      params: { path: { conversation_id: conversationId } },
      body,
    }),
  );
}

export async function setConversationState(
  workspaceId: string,
  conversationId: string,
  state: { read?: boolean; archived?: boolean },
  canEdit: boolean,
) {
  if (!canEdit) return;
  const identity = captureApiRequestIdentity();
  const response = await api().POST("/messages/{conversation_id}/state", {
    params: { path: { conversation_id: conversationId } },
    body: { workspace_id: workspaceId, ...state },
  });
  await settleApiUnauthorized(identity, response.response);
  if (!apiRequestIdentityIsCurrent(identity)) throw new Error("The signed-in Workspace changed.");
  if (response.error)
    throw createOpenPostQueryError(
      response.response.status,
      response.error,
      "Could not update chat",
    );
}

export async function setCommentState(
  workspaceId: string,
  id: string,
  state: { read?: boolean; archived?: boolean },
  canEdit: boolean,
) {
  if (!canEdit) return;
  const identity = captureApiRequestIdentity();
  const response = await api().POST("/engagement/state", {
    body: { workspace_id: workspaceId, ids: [id], ...state },
  });
  await settleApiUnauthorized(identity, response.response);
  if (!apiRequestIdentityIsCurrent(identity)) throw new Error("The signed-in Workspace changed.");
  if (response.error)
    throw createOpenPostQueryError(
      response.response.status,
      response.error,
      "Could not update comment",
    );
}

export function markMatchingCommentsRead(
  workspaceId: string,
  accountId: string,
  archived: boolean,
  kind?: "comment" | "mention" | "review",
) {
  return result(
    api().POST("/engagement/read", {
      body: { workspace_id: workspaceId, account_id: accountId || undefined, archived, kind },
    }),
  );
}

export function queueInboxRefresh(
  workspaceId: string,
  view: "chats" | "comments",
  signal: AbortSignal,
) {
  const body = { workspace_id: workspaceId };
  return view === "chats"
    ? result(api().POST("/messages/refresh", { signal, body }))
    : result(api().POST("/engagement/refresh", { signal, body }));
}
export async function commentAction(
  workspaceId: string,
  itemId: string,
  action: "reply" | "delete_reply" | "hide" | "delete" | "like" | "unlike",
  message?: string,
  clientOperationId?: string,
) {
  if (action === "reply") requireInboxConnection();
  return result(
    api().POST("/engagement/{item_id}/actions", {
      params: { path: { item_id: itemId } },
      body: { workspace_id: workspaceId, action, message, client_operation_id: clientOperationId },
    }),
  );
}

export const mobileMediaAPI: Pick<MediaQueryAPI, "listMedia"> = {
  async listMedia(workspaceId, filters, signal) {
    return result(
      mobileQueryTransportRequest(signal, (signal) =>
        api().GET("/media", {
          signal,
          params: {
            query: {
              workspace_id: workspaceId,
              lifecycle: filters.lifecycle,
              search: filters.search,
              type: filters.type || undefined,
              limit: filters.limit,
              offset: filters.offset,
              sort: filters.sort || undefined,
            },
          },
        }),
      ),
    );
  },
};

export function listConversationMessages(
  workspaceId: string,
  conversationId: string,
  limit: number,
  cursor: string,
  signal: AbortSignal,
): Promise<MessagePage> {
  return result(
    mobileQueryTransportRequest(signal, (signal) =>
      api().GET("/messages/{conversation_id}", {
        signal,
        params: {
          path: { conversation_id: conversationId },
          query: { workspace_id: workspaceId, limit, cursor: cursor || undefined },
        },
      }),
    ),
  );
}
export function retryMessage(workspaceId: string, conversationId: string, messageId: string) {
  requireInboxConnection();
  return result(
    api().POST("/messages/{conversation_id}/retry", {
      params: { path: { conversation_id: conversationId } },
      body: { workspace_id: workspaceId, message_id: messageId },
    }),
  );
}
export async function requestOlderHistory(workspaceId: string, conversationId: string) {
  const identity = captureApiRequestIdentity();
  const response = await api().POST("/messages/{conversation_id}/history", {
    params: { path: { conversation_id: conversationId } },
    body: { workspace_id: workspaceId },
  });
  await settleApiUnauthorized(identity, response.response);
  if (response.error || !response.response.ok)
    throw createOpenPostQueryError(
      response.response.status,
      response.error,
      "Could not load older history",
    );
}
