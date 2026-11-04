import { expect, mock, test } from "bun:test";

const files = new Map<string, string>();
let pendingWrite: { started(): void; release: Promise<void> } | undefined;
mock.module("expo-file-system/legacy", () => ({
  documentDirectory: "file:///inbox-test/",
  getInfoAsync: async (path: string) => ({ exists: files.has(path) }),
  readAsStringAsync: async (path: string) => files.get(path) ?? "",
  makeDirectoryAsync: async () => undefined,
  writeAsStringAsync: async (path: string, content: string) => {
    const pending = pendingWrite;
    pendingWrite = undefined;
    if (pending) {
      pending.started();
      await pending.release;
    }
    files.set(path, content);
  },
  deleteAsync: async () => {
    files.clear();
  },
}));
mock.module("expo-modules-core", () => ({ uuid: { v4: () => "unused" } }));
mock.module("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));
const { readConversationDraft, saveConversationDraft, restoreUnsentConversationSend } =
  await import("./storage");

test("a chat reopened during the pending save sees its editable draft when connectivity is lost, without depending on the old screen", async () => {
  const scope = {
    key: "pending-navigation",
    generation: 0,
    current: () => true,
    canRestore: () => true,
  };
  const before = { text: "Still editable offline", sends: [] };
  await saveConversationDraft(scope, "chat", before);
  let began!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let online = true;
  pendingWrite = { started: began, release: blocked };
  const saving = saveConversationDraft(
    scope,
    "chat",
    {
      text: "",
      sends: [
        {
          operationId: "unsent",
          body: before.text,
          state: "sending",
          createdAt: "2026-10-20T12:00:00Z",
        },
      ],
    },
    { eligible: () => online, rollback: before },
  );
  await started;
  // The original component can disappear while a new one queues its restoration.
  const reopened = readConversationDraft(scope, "chat");
  online = false;
  release();
  await saving;
  expect(await reopened).toEqual(before);
});

test("leaving a public reply during its pending device save cancels unsent admission before a remount reads it", async () => {
  const { PublicReplySession } = await import("./reply");
  const scope = {
    key: "pending-reply-navigation",
    generation: 0,
    current: () => true,
    canRestore: () => true,
  };
  const before = { text: "A reply retained across navigation", sends: [] };
  await saveConversationDraft(scope, "comment", before);
  let began!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  const session = new PublicReplySession({
    read: () => readConversationDraft(scope, "comment"),
    write: (draft, admission) => saveConversationDraft(scope, "comment", draft, admission),
    canEdit: () => true,
    online: () => true,
    current: scope.current,
    newOperationId: () => "unadmitted-public-reply",
    admit: async () => {
      requests++;
      return { job_id: "must-not-dispatch" };
    },
  });
  await session.restore();
  pendingWrite = { started: began, release: blocked };
  const sending = session.submit();
  await started;
  session.setAccess(false, false);
  const reopened = readConversationDraft(scope, "comment");
  release();
  await sending;
  expect(requests).toBe(0);
  expect(await reopened).toEqual(before);
});

test("definite no-dispatch recovery retains later text and never rolls back a newer server receipt", async () => {
  const scope = {
    key: "offline-recovery-receipts",
    generation: 0,
    current: () => true,
    canRestore: () => true,
  };
  const send = {
    operationId: "unsent-operation",
    body: "Original message",
    state: "sending" as const,
    createdAt: "2026-10-20T12:00:00Z",
  };
  await saveConversationDraft(scope, "chat", { text: "Later text", sends: [send] });
  await restoreUnsentConversationSend(scope, "chat", send);
  expect(await readConversationDraft(scope, "chat")).toEqual({
    text: "Original message\nLater text",
    sends: [],
  });
  await saveConversationDraft(scope, "chat", {
    text: "Next draft",
    sends: [{ ...send, state: "queued", serverId: "accepted-message" }],
  });
  await restoreUnsentConversationSend(scope, "chat", send);
  expect(await readConversationDraft(scope, "chat")).toMatchObject({
    text: "Next draft",
    sends: [{ operationId: "unsent-operation", state: "queued", serverId: "accepted-message" }],
  });
});

test("an undispatched draft returns to its original Workspace after a switch during persistence", async () => {
  let workspace = "original";
  const scope = {
    key: "workspace-navigation",
    generation: 0,
    current: () => workspace === "original",
    canRestore: () => true,
  };
  const before = { text: "Draft in the original Workspace", sends: [] };
  await saveConversationDraft(scope, "chat", before);
  let began!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  pendingWrite = { started: began, release: blocked };
  const saving = saveConversationDraft(
    scope,
    "chat",
    {
      text: "",
      sends: [
        {
          operationId: "unsent-workspace",
          body: before.text,
          state: "sending",
          createdAt: "2026-10-20T12:00:00Z",
        },
      ],
    },
    { eligible: scope.current, rollback: before },
  );
  await started;
  workspace = "other";
  release();
  await saving;
  workspace = "original";
  expect(await readConversationDraft(scope, "chat")).toEqual(before);
});
