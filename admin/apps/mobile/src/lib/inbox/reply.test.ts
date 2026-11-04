import { expect, test } from "bun:test";
import { PublicReplySession } from "./reply";
import { parseDraft, type ConversationDraft } from "./state";

const operationId = "5de5172b-639f-4b54-bd72-876dab2e8289";
function fixture(canEdit = true) {
  let disk: ConversationDraft = { text: "Thanks, Alex!", sends: [] };
  const requests: { body: string; operationId: string }[] = [];
  let loseResponse = false;
  let online = true;
  let operationCount = 0;
  const create = () =>
    new PublicReplySession({
      read: async () => parseDraft(JSON.stringify(disk)),
      write: async (value) => {
        disk = JSON.parse(JSON.stringify(value));
      },
      canEdit: () => canEdit,
      online: () => online,
      current: () => true,
      newOperationId: () => (operationCount++ ? "intentional-replacement" : operationId),
      admit: async (body, id) => {
        expect(disk.sends[0]?.operationId).toBe(id);
        requests.push({ body, operationId: id });
        if (loseResponse) throw new Error("connection lost after admission");
        return { job_id: id === operationId ? "reply-job" : "replacement-job" };
      },
    });
  return {
    create,
    requests,
    online: (value: boolean) => {
      online = value;
    },
    disk: () => disk,
    loseResponse: (value: boolean) => {
      loseResponse = value;
    },
  };
}
test("lost reply admission survives restart and replays the same UUID, retaining body until provider completion", async () => {
  const f = fixture();
  const first = f.create();
  await first.restore();
  f.loseResponse(true);
  await first.submit();
  expect(f.disk().sends[0]).toMatchObject({
    operationId,
    body: "Thanks, Alex!",
    state: "ambiguous",
  });
  const reopened = f.create();
  await reopened.restore();
  f.loseResponse(false);
  await reopened.submit();
  expect(f.requests).toEqual([
    { body: "Thanks, Alex!", operationId },
    { body: "Thanks, Alex!", operationId },
  ]);
  expect(f.disk()).toMatchObject({
    text: "Thanks, Alex!",
    sends: [{ jobId: "reply-job", state: "queued", operationId }],
  });
  await reopened.observe({ id: "reply-job", status: "processing" });
  expect(reopened.snapshot().operation?.state).toBe("queued");
  await reopened.observe({ id: "reply-job", status: "completed" });
  expect(f.disk()).toMatchObject({
    text: "",
    sends: [{ state: "confirmed", operationId, jobId: "reply-job" }],
  });
});
test("a provider job failure retains text and receipt, and submit cannot create another operation", async () => {
  const f = fixture();
  const session = f.create();
  await session.restore();
  await session.submit();
  await session.observe({
    id: "reply-job",
    status: "failed",
    last_error: "Provider rejected this reply",
  });
  const reopened = f.create();
  await reopened.restore();
  await reopened.submit();
  expect(f.requests).toHaveLength(1);
  expect(f.disk()).toMatchObject({
    text: "Thanks, Alex!",
    sends: [
      { state: "failed", operationId, jobId: "reply-job", error: "Provider rejected this reply" },
    ],
  });
});
test("a viewer can restore a draft without dispatching a reply", async () => {
  const f = fixture(false);
  const session = f.create();
  await session.restore();
  await session.submit();
  expect(f.requests).toEqual([]);
  expect(f.disk()).toEqual({ text: "Thanks, Alex!", sends: [] });
});
test("typing updates the controlled native field immediately while device persistence is pending", async () => {
  let release: (() => void) | undefined;
  const session = new PublicReplySession({
    read: async () => ({ text: "", sends: [] }),
    write: () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    canEdit: () => true,
    online: () => true,
    current: () => true,
    newOperationId: () => operationId,
    admit: async () => ({ job_id: "unused" }),
  });
  await session.restore();
  const save = session.setText("Thanks, Alex");
  expect(session.snapshot().text).toBe("Thanks, Alex");
  release?.();
  await save;
});
test("a failed reply survives restart and explicit new-reply recovery preserves its receipt before a distinct intentional send", async () => {
  const f = fixture();
  const session = f.create();
  await session.restore();
  await session.submit();
  await session.observe({
    id: "reply-job",
    status: "failed",
    last_error: "Reconnect this receiving account",
  });
  const reopened = f.create();
  await reopened.restore();
  await reopened.startNewReply();
  expect(f.requests).toHaveLength(1);
  expect(reopened.snapshot()).toMatchObject({
    text: "Thanks, Alex!",
    operation: null,
    history: [{ jobId: "reply-job", operationId, state: "failed" }],
  });
  await reopened.setText("Thanks, Alex! The account is reconnected.");
  await reopened.submit();
  expect(f.requests[1]).toEqual({
    body: "Thanks, Alex! The account is reconnected.",
    operationId: "intentional-replacement",
  });
  const restored = f.create();
  await restored.restore();
  expect(restored.snapshot().history[0]).toMatchObject({
    jobId: "reply-job",
    operationId,
    state: "failed",
  });
});
test("unknown admission cannot be replaced by the explicit failed-job recovery action", async () => {
  const f = fixture();
  const session = f.create();
  await session.restore();
  f.loseResponse(true);
  await session.submit();
  await session.startNewReply();
  await session.setText("Different body");
  expect(session.snapshot()).toMatchObject({
    text: "Thanks, Alex!",
    operation: { operationId, state: "ambiguous" },
  });
  expect(f.requests).toHaveLength(1);
});
test("an unknown provider outcome with a known receipt cannot be replaced as a confirmed failure", async () => {
  const f = fixture();
  const session = f.create();
  await session.restore();
  await session.submit();
  await session.observe({ id: "reply-job", status: "unknown" });
  await session.startNewReply();
  await session.setText("Another body");
  expect(session.snapshot()).toMatchObject({
    text: "Thanks, Alex!",
    operation: { state: "queued", jobId: "reply-job", operationId },
  });
  expect(f.requests).toHaveLength(1);
});

test("offline reply typing stays editable and reconnection requires an explicit send, including an ambiguous retry", async () => {
  const f = fixture();
  const session = f.create();
  await session.restore();
  f.online(false);
  await session.setText("Draft written offline");
  await session.submit();
  expect(f.requests).toHaveLength(0);
  expect(f.disk()).toEqual({ text: "Draft written offline", sends: [] });
  f.online(true);
  expect(f.requests).toHaveLength(0);
  f.loseResponse(true);
  await session.submit();
  expect(f.requests).toHaveLength(1);
  f.online(false);
  await session.submit();
  expect(f.requests).toHaveLength(1);
  expect(session.snapshot().operation).toMatchObject({ operationId, state: "ambiguous" });
  f.online(true);
  f.loseResponse(false);
  expect(f.requests).toHaveLength(1);
  await session.submit();
  expect(f.requests[1]).toEqual({ body: "Draft written offline", operationId });
});

test("disconnecting during durable reply admission restores the editable draft without dispatch", async () => {
  let online = true;
  const requests: string[] = [];
  let disk: ConversationDraft = { text: "Keep this draft", sends: [] };
  const session = new PublicReplySession({
    read: async () => disk,
    write: async (value) => {
      disk = value;
      online = false;
    },
    canEdit: () => true,
    online: () => online,
    current: () => true,
    newOperationId: () => operationId,
    admit: async (body) => {
      requests.push(body);
      return { job_id: "must-not-dispatch" };
    },
  });
  await session.restore();
  await session.submit();
  expect(requests).toEqual([]);
  expect(disk).toEqual({ text: "Keep this draft", sends: [] });
  expect(session.snapshot().operation).toBeNull();
  await session.setText("Still editable");
  expect(session.snapshot().text).toBe("Still editable");
});

test("pending reply admission locks the submitted body before the asynchronous device write completes", async () => {
  let release!: () => void;
  const saved = new Promise<void>((resolve) => {
    release = resolve;
  });
  let disk: ConversationDraft = { text: "The submitted body", sends: [] };
  const requests: string[] = [];
  const session = new PublicReplySession({
    read: async () => disk,
    write: async (draft) => {
      await saved;
      disk = draft;
    },
    canEdit: () => true,
    online: () => true,
    current: () => true,
    newOperationId: () => operationId,
    admit: async (body) => {
      requests.push(body);
      return { job_id: "reply-job" };
    },
  });
  await session.restore();
  const submitting = session.submit();
  expect(session.snapshot().operation?.state).toBe("sending");
  const typing = session.setText("A different body");
  release();
  await Promise.all([submitting, typing]);
  expect(requests).toEqual(["The submitted body"]);
  expect(disk).toMatchObject({
    text: "The submitted body",
    sends: [{ operationId, jobId: "reply-job" }],
  });
});

test("an accepted owner reply can be deliberately replaced while retaining its first receipt", async () => {
  const f = fixture();
  const session = f.create();
  await session.restore();
  await session.submit();
  await session.observe({ id: "reply-job", status: "completed" });
  await session.startNewReply("Updated owner reply");
  expect(session.snapshot().text).toBe("Updated owner reply");
  expect(session.snapshot().history).toMatchObject([
    { operationId, jobId: "reply-job", state: "confirmed" },
  ]);
  await session.submit();
  expect(f.requests).toEqual([
    { body: "Thanks, Alex!", operationId },
    { body: "Updated owner reply", operationId: "intentional-replacement" },
  ]);
});

test("owner reply removal survives lost admission and restart with one durable identity", async () => {
  let disk: ConversationDraft = { text: "", sends: [] };
  const requests: string[] = [];
  let lost = true;
  const create = () =>
    new PublicReplySession({
      action: "delete_reply",
      read: async () => parseDraft(JSON.stringify(disk)),
      write: async (value) => {
        disk = value;
      },
      admit: async (body, id) => {
        expect(body).toBe("");
        expect(disk.sends[0]?.operationId).toBe(id);
        requests.push(id);
        if (lost) throw new Error("lost removal response");
        return { job_id: "removal-receipt" };
      },
      newOperationId: () => operationId,
      canEdit: () => true,
      online: () => true,
      current: () => true,
    });
  const first = create();
  await first.restore();
  await first.submit();
  expect(disk.sends[0]?.state).toBe("ambiguous");
  const reopened = create();
  await reopened.restore();
  lost = false;
  await reopened.submit();
  expect(requests).toEqual([operationId, operationId]);
  await reopened.observe({ id: "removal-receipt", status: "completed" });
  await reopened.submit();
  expect(requests).toHaveLength(2);
});
