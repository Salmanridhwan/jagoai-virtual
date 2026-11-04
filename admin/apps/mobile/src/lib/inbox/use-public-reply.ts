import { useEffect, useMemo, useSyncExternalStore } from "react";
import { commentAction } from "./api";
import { getInboxOnline } from "./connection";
import { PublicReplySession } from "./reply";
import {
  inboxStorageScope,
  newInboxOperationId,
  readConversationDraft,
  saveConversationDraft,
} from "./storage";
import { useInboxJob } from "./use-job";

export function usePublicReply(workspaceId: string, itemId: string, canEdit: boolean) {
  return useReplyIntent(workspaceId, itemId, canEdit, "reply");
}

export function useOwnerReplyRemoval(workspaceId: string, itemId: string, canEdit: boolean) {
  return useReplyIntent(workspaceId, itemId, canEdit, "delete_reply");
}

function useReplyIntent(
  workspaceId: string,
  itemId: string,
  canEdit: boolean,
  action: "reply" | "delete_reply",
) {
  const session = useMemo(() => {
    const scope = inboxStorageScope(workspaceId);
    const draftId = `${action === "reply" ? "comment" : "review-removal"}-${itemId}`;
    return new PublicReplySession({
      action,
      read: () => readConversationDraft(scope, draftId),
      write: (draft, admission) => saveConversationDraft(scope, draftId, draft, admission),
      admit: (body, operationId) =>
        commentAction(
          workspaceId,
          itemId,
          action,
          action === "reply" ? body : undefined,
          operationId,
        ),
      newOperationId: newInboxOperationId,
      current: scope.current,
      canEdit: () => false,
      online: getInboxOnline,
    });
  }, [workspaceId, itemId, action]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  const receipt = useInboxJob(workspaceId, state.operation?.jobId);
  useEffect(() => {
    session.setAccess(canEdit, true);
    return () => session.setAccess(false, false);
  }, [session, canEdit]);
  useEffect(() => {
    void session.restore();
  }, [session]);
  useEffect(() => {
    if (receipt.job) void session.observe(receipt.job);
  }, [session, receipt.job]);
  return {
    ...state,
    receipt,
    setText: (text: string) => {
      void session.setText(text);
    },
    submit: () => {
      void session.submit();
    },
    startNewReply: (text?: string) => session.startNewReply(text),
  };
}
