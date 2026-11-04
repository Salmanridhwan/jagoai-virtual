import { QueryClient, QueryObserver, type InfiniteData } from "@tanstack/query-core";
import { describe, expect, it } from "vitest";
import { reconcileInboxChanges, startInboxUpdates } from "./inbox-updates";
import { inboxQueryKeys, type MessagePage } from "./inbox";

function message(id: string, body: string, day: string): NonNullable<MessagePage["items"]>[number] {
  return {
    id,
    body,
    conversation_id: "chat",
    workspace_id: "ws",
    direction: "inbound",
    remote_message_id: id,
    author_remote_id: "person",
    attachments_json: "[]",
    send_status: "received",
    error_message: "",
    created_at: day,
    updated_at: day,
    remote_created_at: day,
  };
}
describe("foreground inbox updates", () => {
  it("patches older loaded messages and removes reconciled echoes without fetching history", () => {
    const client = new QueryClient();
    const key = inboxQueryKeys.messages("ws", "chat", {});
    const otherKey = inboxQueryKeys.messages("other", "chat", {});
    const old = {
      pages: [
        { items: [message("new", "new", "2026-10-20")], next_cursor: "older" },
        {
          items: [
            message("old", "before", "2026-10-19"),
            message("echo", "duplicate", "2026-10-19"),
          ],
        },
      ],
      pageParams: ["", "older"],
    };
    client.setQueryData(key, old);
    client.setQueryData(otherKey, old);
    reconcileInboxChanges(client, "ws", {
      cursor: "next",
      reset: false,
      changes: [
        { revision: 1, kind: "message", conversation_id: "chat", message_id: "old" },
        {
          revision: 2,
          kind: "message",
          conversation_id: "chat",
          message_id: "echo",
          deleted: true,
        },
      ],
      messages: [message("old", "after", "2026-10-19")],
    });
    expect(client.getQueryData(key)).toEqual({
      pages: [old.pages[0], { items: [message("old", "after", "2026-10-19")] }],
      pageParams: ["", "older"],
    });
    expect(client.getQueryData(otherKey)).toEqual(old);
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    client.clear();
  });
  it("updates open-chat metadata without a new message and refreshes completed history", () => {
    const client = new QueryClient();
    const key = inboxQueryKeys.messages("ws", "chat", {});
    const conversation: NonNullable<MessagePage["conversation"]> = {
      id: "chat",
      workspace_id: "ws",
      social_account_id: "account",
      platform: "bluesky",
      remote_conversation_id: "remote-chat",
      counterpart_remote_id: "person",
      counterpart_name: "Alex",
      counterpart_handle: "alex.bsky.social",
      counterpart_avatar_url: "",
      last_message_at: "2026-10-20T12:00:00Z",
      last_message_preview: "Hello",
      last_remote_message_id: "new",
      unread_count: 3,
      created_at: "2026-10-19T12:00:00Z",
      updated_at: "2026-10-20T12:00:00Z",
    };
    const rows = [message("new", "Hello", "2026-10-20T12:00:00Z")];
    client.setQueryData(key, {
      pages: [{ items: rows, conversation, history_available: true }],
      pageParams: [""],
    });
    reconcileInboxChanges(client, "ws", {
      cursor: "read",
      reset: false,
      messages: [],
      conversations: [{ ...conversation, unread_count: 0 }],
      changes: [{ revision: 1, kind: "conversation", conversation_id: "chat" }],
    });
    expect(client.getQueryData(key)).toEqual({
      pages: [
        {
          items: rows,
          conversation: { ...conversation, unread_count: 0 },
          history_available: true,
        },
      ],
      pageParams: [""],
    });
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    reconcileInboxChanges(client, "ws", {
      cursor: "history",
      reset: false,
      messages: [],
      changes: [{ revision: 2, kind: "message", conversation_id: "chat" }],
    });
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    // Keep the visible rows while the canonical history query refreshes its cursor.
    expect(client.getQueryData(key)).toMatchObject({ pages: [{ items: rows }] });
    client.clear();
  });
  it("removes deleted conversation content immediately while retaining local pending sends", () => {
    const client = new QueryClient();
    const key = inboxQueryKeys.messages("ws", "chat", {});
    const queued = {
      ...message("local", "Draft awaiting delivery", "2026-10-20"),
      remote_message_id: "",
      send_status: "queued",
    };
    client.setQueryData(key, {
      pages: [
        { items: [message("recent", "Recent private content", "2026-10-20"), queued] },
        { items: [message("old", "Older private content", "2026-10-19")] },
      ],
      pageParams: ["", "older"],
    });
    reconcileInboxChanges(client, "ws", {
      cursor: "deleted",
      reset: false,
      messages: [],
      changes: [{ revision: 1, kind: "conversation", conversation_id: "chat", deleted: true }],
    });
    const rows = client
      .getQueryData<InfiniteData<MessagePage>>(key)
      ?.pages.flatMap((p) => p.items ?? []);
    for (const id of ["recent", "old"])
      expect(rows?.find((row) => row.id === id)).toMatchObject({
        body: "",
        attachments_json: "[]",
        author_remote_id: "",
      });
    expect(rows?.find((row) => row.id === "local")).toEqual(queued);
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    client.clear();
  });
  it.each([false, true])(
    "keeps committed updates when a %s cached read returns late",
    async (warm) => {
      const client = new QueryClient();
      const key = inboxQueryKeys.messages("ws", "chat", {});
      const before: InfiniteData<MessagePage> = {
        pages: [{ items: [message("new", "before", "2026-10-20")] }],
        pageParams: [""],
      };
      const after: InfiniteData<MessagePage> = {
        pages: [{ items: [message("new", "after", "2026-10-20")] }],
        pageParams: [""],
      };
      if (warm) client.setQueryData(key, before);
      let release: (data: InfiniteData<MessagePage>) => void = () => {};
      const late = new Promise<InfiniteData<MessagePage>>((resolve) => {
        release = resolve;
      });
      let calls = 0;
      const observer = new QueryObserver(client, {
        queryKey: key,
        retry: false,
        queryFn: () => {
          calls += 1;
          return calls === 1 ? late : Promise.resolve(after);
        },
      });
      const unsubscribe = observer.subscribe(() => {});
      try {
        reconcileInboxChanges(client, "ws", {
          cursor: "commit",
          reset: false,
          changes: [{ revision: 1, kind: "message", conversation_id: "chat", message_id: "new" }],
          messages: [message("new", "after", "2026-10-20")],
        });
        release(before);
        await late;
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(observer.getCurrentResult().data).toEqual(after);
        expect(observer.getCurrentResult().fetchStatus).toBe("idle");
      } finally {
        unsubscribe();
        client.clear();
      }
    },
  );
  it("discards a response that arrives after its identity owner is cancelled", async () => {
    const client = new QueryClient();
    const controller = new AbortController();
    let deliver: ((page: { cursor: string; reset: boolean; changes: [] }) => void) | undefined;
    const stop = startInboxUpdates({
      queryClient: client,
      workspaceId: "ws",
      clientId: "device",
      view: "chats",
      signal: controller.signal,
      api: {
        inboxActivity: async () => {},
        inboxChanges: () =>
          new Promise((resolve) => {
            deliver = resolve;
          }),
      },
    });
    controller.abort();
    deliver?.({ cursor: "late", reset: true, changes: [] });
    await Promise.resolve();
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    stop();
    client.clear();
  });
});
