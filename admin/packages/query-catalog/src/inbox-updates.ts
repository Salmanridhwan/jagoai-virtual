import type { InfiniteData, QueryClient } from "@tanstack/query-core";
import { openPostWorkspaceKey } from "./keys";
import { inboxQueryKeys, type ConversationPage, type MessagePage } from "./inbox";

export type InboxView = "chats" | "comments" | "conversation" | "away";
export interface InboxChange {
  revision: number;
  kind: "conversation" | "message" | "engagement";
  conversation_id?: string;
  message_id?: string;
  engagement_id?: string;
  deleted?: boolean;
}
export interface InboxChangePage {
  cursor: string;
  reset: boolean;
  changes: readonly InboxChange[];
  messages?: MessagePage["items"];
  conversations?: ConversationPage["items"];
}
export interface InboxUpdateAPI {
  inboxChanges(workspaceId: string, cursor: string, signal: AbortSignal): Promise<InboxChangePage>;
  inboxActivity(
    workspaceId: string,
    activity: { clientId: string; view: InboxView; conversationId?: string },
    signal: AbortSignal,
  ): Promise<void>;
}
export interface InboxUpdateOptions {
  api: InboxUpdateAPI;
  queryClient: QueryClient;
  workspaceId: string;
  clientId: string;
  view: InboxView;
  conversationId?: string;
  signal: AbortSignal;
  onError?: (error: unknown) => void;
}

// Only the foreground owner starts this loop. A new identity or view gets its
// own controller; old responses cannot write into its cache after cancellation.
export function startInboxUpdates(options: InboxUpdateOptions): () => void {
  const controller = new AbortController();
  const stop = () => controller.abort();
  if (options.signal.aborted) {
    stop();
    return stop;
  }
  options.signal.addEventListener("abort", stop, { once: true });
  const signal = controller.signal;
  const pause = (ms: number) =>
    new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      signal.addEventListener("abort", done, { once: true });
    });
  async function heartbeat() {
    while (!signal.aborted) {
      try {
        await options.api.inboxActivity(
          options.workspaceId,
          {
            clientId: options.clientId,
            view: options.view,
            ...(options.conversationId ? { conversationId: options.conversationId } : {}),
          },
          signal,
        );
      } catch (error) {
        if (!signal.aborted) options.onError?.(error);
      }
      await pause(20_000);
    }
  }
  async function updates() {
    let cursor = "";
    let failures = 0;
    while (!signal.aborted) {
      try {
        const page = await options.api.inboxChanges(options.workspaceId, cursor, signal);
        if (signal.aborted) return;
        reconcileInboxChanges(options.queryClient, options.workspaceId, page);
        cursor = page.cursor;
        failures = 0;
      } catch (error) {
        if (signal.aborted) return;
        options.onError?.(error);
        // A rejected credential stops the owner through its normal auth path.
        // Bounded backoff also prevents tight loops during server/provider loss.
        failures += 1;
        await pause(Math.min(30_000, 1_000 * 2 ** Math.min(failures - 1, 5)));
      }
    }
  }
  void heartbeat();
  void updates();
  return () => {
    options.signal.removeEventListener("abort", stop);
    stop();
  };
}

export function reconcileInboxChanges(
  client: QueryClient,
  workspaceId: string,
  page: InboxChangePage,
): void {
  if (page.reset) {
    void client.cancelQueries({ queryKey: openPostWorkspaceKey(workspaceId, "messages") });
    void client.invalidateQueries({ queryKey: openPostWorkspaceKey(workspaceId, "messages") });
  }
  const conversationIds = new Set<string>();
  let conversationsChanged = false;
  let engagementChanged = page.reset;
  for (const change of page.changes) {
    if (change.kind === "engagement") engagementChanged = true;
    else conversationsChanged = true;
    if (change.conversation_id) conversationIds.add(change.conversation_id);
  }
  for (const conversationId of conversationIds) {
    const messageKey = inboxQueryKeys.messagesRoot(workspaceId, conversationId);
    const hasColdRead = client
      .getQueriesData<InfiniteData<MessagePage>>({ queryKey: messageKey })
      .some(([, data]) => !data?.pages.length);
    // Stop an older in-flight snapshot before patching committed events. A cold
    // read has no rows to patch, so restart it after the observed commit.
    void client.cancelQueries({ queryKey: messageKey });
    const conversationDeleted = page.changes.some(
      (change) =>
        change.kind === "conversation" &&
        change.conversation_id === conversationId &&
        change.deleted,
    );
    const records = (page.messages ?? []).filter((item) => item.conversation_id === conversationId);
    const removed = new Set(
      page.changes
        .filter(
          (c) =>
            c.deleted &&
            c.conversation_id === conversationId &&
            c.message_id &&
            !records.some((m) => m.id === c.message_id),
        )
        .map((c) => c.message_id),
    );
    if (
      hasColdRead ||
      !page.messages ||
      page.changes.some(
        (change) =>
          change.kind === "message" &&
          change.conversation_id === conversationId &&
          !change.message_id,
      )
    ) {
      void client.invalidateQueries({
        queryKey: inboxQueryKeys.messagesRoot(workspaceId, conversationId),
      });
      continue;
    }
    const conversation = page.conversations?.find((c) => c.id === conversationId);
    client.setQueriesData<InfiniteData<MessagePage>>(
      { queryKey: inboxQueryKeys.messagesRoot(workspaceId, conversationId) },
      (old) => {
        if (!old || !old.pages.length) return old;
        const byId = new Map(records.map((item) => [item.id, item]));
        const seen = new Set<string>();
        const pages = old.pages.map((p) => ({
          ...p,
          ...(conversation ? { conversation } : {}),
          items: (p.items ?? [])
            .filter((m) => !removed.has(m.id))
            .map((m) => {
              seen.add(m.id);
              const next = byId.get(m.id) ?? m;
              return conversationDeleted && next.remote_message_id
                ? {
                    ...next,
                    body: "",
                    attachments_json: "[]",
                    author_remote_id: "",
                    deleted_at: conversation?.archived_at ?? new Date().toISOString(),
                  }
                : next;
            }),
        }));
        const newest = pages[0];
        if (newest) {
          const earliest = newest.items[0];
          const earliestTime = earliest ? earliest.remote_created_at || earliest.created_at : "";
          newest.items.push(
            ...records.filter(
              (m) =>
                !seen.has(m.id) &&
                (!earliestTime || (m.remote_created_at || m.created_at) >= earliestTime),
            ),
          );
          newest.items.sort(
            (a, b) =>
              (a.remote_created_at || a.created_at).localeCompare(
                b.remote_created_at || b.created_at,
              ) ||
              a.created_at.localeCompare(b.created_at) ||
              a.id.localeCompare(b.id),
          );
        }
        return { ...old, pages };
      },
    );
    if (conversationDeleted) void client.invalidateQueries({ queryKey: messageKey });
  }
  // List filters can depend on server-side message search, account permission,
  // and unread state. The server remains authoritative for their membership.
  if (page.reset || conversationsChanged || engagementChanged)
    void client.invalidateQueries({ queryKey: inboxQueryKeys.summary(workspaceId) });
  if (conversationsChanged && !page.reset)
    void client.invalidateQueries({ queryKey: inboxQueryKeys.conversationsRoot(workspaceId) });
  if (engagementChanged)
    void client.invalidateQueries({ queryKey: inboxQueryKeys.engagementRoot(workspaceId) });
}
