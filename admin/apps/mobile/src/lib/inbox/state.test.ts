import { describe, expect, test } from "bun:test";
import { parseDraft, reconcileSends, uniqueMessages, type PendingSend } from "./state";
import type { DirectMessage } from "./api";

const pending: PendingSend = {
  operationId: "942cc7ab-1f00-42cb-a1d0-31e8c715c47b",
  body: "Did the launch go well?",
  createdAt: "2026-10-20T10:00:00Z",
  state: "sending",
};
function message(id: string, time: string, patch: Partial<DirectMessage> = {}): DirectMessage {
  return {
    id,
    body: "hello",
    conversation_id: "chat",
    workspace_id: "workspace",
    created_at: time,
    remote_created_at: time,
    updated_at: time,
    attachments_json: "[]",
    author_remote_id: "author",
    direction: "inbound",
    error_message: "",
    remote_message_id: `remote-${id}`,
    send_status: "sent",
    ...patch,
  };
}
describe("native chat recovery", () => {
  test("a crash retains the exact retry identity and authored draft without resending", () => {
    const restored = parseDraft(JSON.stringify({ text: "Next thought", sends: [pending] }));
    expect(restored.text).toBe("Next thought");
    expect(restored.sends[0]).toMatchObject({
      operationId: pending.operationId,
      body: pending.body,
      state: "ambiguous",
    });
  });
  test("a feed receipt before the HTTP response replaces only its matching optimistic message", () => {
    const other: PendingSend = { ...pending, operationId: "different", body: "Another message" };
    const receipt = message("server-message", pending.createdAt, {
      client_operation_id: pending.operationId,
      direction: "outbound",
      send_status: "queued",
    });
    expect(reconcileSends([pending, other], [receipt])).toEqual([other]);
    expect(
      reconcileSends([pending], [message("unrelated", pending.createdAt, { body: pending.body })]),
    ).toEqual([pending]);
  });
  test("history overlap keeps the newest server state and stable newest-first chronology", () => {
    const old = message("one", "2026-10-20T10:00:00Z", { send_status: "queued" });
    const newer = message("two", "2026-10-20T10:01:00Z");
    const updated = { ...old, send_status: "sent", body: "updated by server" };
    expect(uniqueMessages([{ items: [newer, updated] }, { items: [old] }])).toEqual([
      newer,
      updated,
    ]);
  });
  test("invalid persisted state cannot supply an executable retry operation", () => {
    expect(
      parseDraft(
        JSON.stringify({ text: "kept", sends: [{ body: "missing UUID", state: "sending" }] }),
      ),
    ).toEqual({ text: "kept", sends: [] });
    expect(() => parseDraft('{"text":4,"sends":[]}')).toThrow();
  });
});
