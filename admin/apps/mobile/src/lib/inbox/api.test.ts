import { onlineManager } from "@tanstack/react-query";
import { expect, mock, spyOn, test } from "bun:test";
mock.module("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));
const {
  setConversationState,
  setCommentState,
  sendMessage,
  retryMessage,
  commentAction,
  mobileInboxAPI,
} = await import("./api");
const { setServer, clearServer } = await import("../server");

test("viewer read and archive paths never send a write, while editor paths use workspace-scoped state endpoints", async () => {
  const requests: Request[] = [];
  const transport = Object.assign(
    async (input: Parameters<typeof fetch>[0]) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request);
      return new Response(null, { status: 204 });
    },
    { preconnect: () => undefined },
  );
  const network = spyOn(globalThis, "fetch").mockImplementation(transport);
  try {
    await setServer("https://native-inbox-review.invalid");
    await setConversationState("workspace", "chat", { read: true }, false);
    await setConversationState("workspace", "chat", { archived: true }, false);
    await setCommentState("workspace", "comment", { read: true }, false);
    await setCommentState("workspace", "comment", { archived: true }, false);
    expect(requests).toHaveLength(0);
    await setConversationState("workspace", "chat", { read: true }, true);
    await setCommentState("workspace", "comment", { archived: true }, true);
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/api/v1/messages/chat/state",
      "/api/v1/engagement/state",
    ]);
    expect(await requests[0].json()).toEqual({ workspace_id: "workspace", read: true });
    expect(await requests[1].json()).toEqual({
      workspace_id: "workspace",
      ids: ["comment"],
      archived: true,
    });
  } finally {
    network.mockRestore();
    await clearServer();
  }
});

test("offline message admission and retries never dispatch HTTP", async () => {
  let requests = 0;
  const network = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async () => {
        requests++;
        return Response.json({ id: "admitted", job_id: "reply-job" });
      },
      { preconnect: () => undefined },
    ),
  );
  const wasOnline = onlineManager.isOnline();
  try {
    await setServer("https://native-inbox-review.invalid");
    onlineManager.setOnline(false);
    await expect(sendMessage("workspace", "chat", "Keep draft", "operation")).rejects.toThrow(
      "offline",
    );
    expect(() => retryMessage("workspace", "chat", "message")).toThrow("offline");
    await expect(
      commentAction("workspace", "comment", "reply", "Keep reply", "reply-operation"),
    ).rejects.toThrow("offline");
    expect(requests).toBe(0);
    onlineManager.setOnline(true);
    expect(requests).toBe(0);
    await sendMessage("workspace", "chat", "Keep draft", "operation");
    expect(requests).toBe(1);
  } finally {
    onlineManager.setOnline(wasOnline);
    network.mockRestore();
    await clearServer();
  }
});

test("Inbox reads reject an empty successful response instead of caching it as summary data", async () => {
  const network = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(async () => Response.json(null), { preconnect: () => undefined }),
  );
  try {
    await setServer("https://native-inbox-review.invalid");
    await expect(
      mobileInboxAPI.getInboxSummary("workspace", new AbortController().signal),
    ).rejects.toThrow("empty response");
  } finally {
    network.mockRestore();
    await clearServer();
  }
});
