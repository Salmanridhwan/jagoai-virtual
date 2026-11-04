import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { OpenPostQueryError, reconcileInboxChanges } from "@openpost/query-catalog";
import { getInboxOnline, InboxOfflineError } from "./connection";
import { sendMessage, type DirectMessage } from "./api";
import {
  inboxStorageScope,
  newInboxOperationId,
  readConversationDraft,
  saveConversationDraft,
  restoreUnsentConversationSend,
  type DraftAdmission,
} from "./storage";
import { reconcileSends, type ConversationDraft, type PendingSend } from "./state";

export function useChatComposer(
  workspaceId: string,
  conversationId: string,
  messages: readonly DirectMessage[],
) {
  const scope = useMemo(() => inboxStorageScope(workspaceId), [workspaceId]);
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ConversationDraft>({ text: "", sends: [] });
  const current = useRef(draft);
  const mounted = useRef(true);
  const inFlight = useRef(new Set<string>());
  const admitting = useRef(false);
  const [admissionBusy, setAdmissionBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = useCallback(
    (next: ConversationDraft, admission?: DraftAdmission) => {
      current.current = next;
      if (mounted.current && scope.current()) setDraft(next);
      return saveConversationDraft(scope, conversationId, next, admission);
    },
    [scope, conversationId],
  );
  useEffect(() => {
    mounted.current = true;
    let active = true;
    void readConversationDraft(scope, conversationId)
      .then((saved) => {
        if (active && scope.current()) {
          current.current = saved;
          setDraft(saved);
          setReady(true);
        }
      })
      .catch(() => {
        if (active) setError("Could not read this chat's saved draft. Try reopening the chat.");
      });
    return () => {
      active = false;
      mounted.current = false;
    };
  }, [scope, conversationId]);
  useEffect(() => {
    if (!ready) return;
    const sends = reconcileSends(current.current.sends, messages);
    if (sends.length !== current.current.sends.length)
      void update({ ...current.current, sends }).catch(() =>
        setError("Could not save chat state."),
      );
  }, [messages, ready, update]); // update reads the latest draft to preserve text typed during refresh.

  async function submit(existing?: PendingSend) {
    if (!ready || admitting.current || !scope.current() || !getInboxOnline()) return;
    const body = existing?.body ?? current.current.text.trim();
    if (!body) return;
    const send: PendingSend = {
      ...existing,
      operationId: existing?.operationId ?? newInboxOperationId(),
      body,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      state: "sending",
      error: undefined,
    };
    if (inFlight.current.has(send.operationId)) return;
    inFlight.current.add(send.operationId);
    setError(null);
    const before = current.current;
    try {
      // A crash before dispatch leaves an unconfirmed operation, with the same UUID on retry.
      admitting.current = true;
      setAdmissionBusy(true);
      const saved = await update(
        {
          text: existing ? before.text : "",
          sends: [...before.sends.filter((row) => row.operationId !== send.operationId), send],
        },
        {
          eligible: () => mounted.current && scope.current() && getInboxOnline(),
          rollback: before,
        },
      );
      if (!saved) {
        current.current = before;
        if (mounted.current && scope.current()) setDraft(before);
        return;
      }
      if (!scope.current()) return;
      const response = await sendMessage(workspaceId, conversationId, body, send.operationId);
      if (!scope.current()) return;
      reconcileInboxChanges(queryClient, workspaceId, {
        cursor: "",
        reset: false,
        changes: [
          {
            revision: 0,
            kind: "message",
            conversation_id: conversationId,
            message_id: response.id,
          },
        ],
        messages: [response],
      });
      if (!mounted.current) return;
      await update({
        ...current.current,
        sends: current.current.sends.map((row) =>
          row.operationId === send.operationId
            ? { ...row, serverId: response.id, state: "queued", error: undefined }
            : row,
        ),
      });
    } catch (cause) {
      if (cause instanceof InboxOfflineError && scope.canRestore()) {
        const restored = await restoreUnsentConversationSend(
          scope,
          conversationId,
          send,
          existing,
        ).catch(() => {
          if (mounted.current && scope.current())
            setError("Could not restore the unsent draft. Reopen this chat before retrying.");
          return undefined;
        });
        if (mounted.current && scope.current()) {
          if (restored) {
            current.current = restored;
            setDraft(restored);
          }
          setError(cause.message);
        }
        return;
      }
      if (mounted.current && scope.current()) {
        const message = cause instanceof Error ? cause.message : "Delivery could not be confirmed.";
        const state =
          cause instanceof OpenPostQueryError &&
          cause.status !== undefined &&
          cause.status >= 400 &&
          cause.status < 500 &&
          ![408, 425].includes(cause.status)
            ? "failed"
            : "ambiguous";
        await update({
          ...current.current,
          sends: current.current.sends.map((row) =>
            row.operationId === send.operationId ? { ...row, state, error: message } : row,
          ),
        }).catch(() => {
          if (mounted.current)
            setError("Could not save the send result. Reopen this chat before retrying.");
        });
      }
    } finally {
      admitting.current = false;
      if (mounted.current) setAdmissionBusy(false);
      inFlight.current.delete(send.operationId);
    }
  }
  return {
    draft,
    ready,
    admissionBusy,
    error,
    setText: (text: string) => {
      if (admitting.current) return;
      void update({ ...current.current, text }).catch(() =>
        setError("Could not save this draft on your device."),
      );
    },
    submit,
  };
}
