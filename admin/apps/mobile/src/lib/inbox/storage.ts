import * as FileSystem from "expo-file-system/legacy";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { uuid } from "expo-modules-core";
import {
  captureApiRequestIdentity,
  apiRequestIdentityIsCurrent,
  apiActorIdentityIsCurrent,
} from "../api/client";
import { parseDraft, type ConversationDraft, type PendingSend } from "./state";

const directory = `${FileSystem.documentDirectory}inbox/`;
let pending: Promise<unknown> = Promise.resolve();
let generation = 0;
function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation);
  pending = result.catch(() => undefined);
  return result;
}

export function inboxStorageScope(workspaceId: string) {
  const identity = captureApiRequestIdentity();
  const hash = bytesToHex(
    sha256(utf8ToBytes(JSON.stringify([identity.serverBaseUrl, identity.token, workspaceId]))),
  );
  return {
    key: hash,
    current: () => apiRequestIdentityIsCurrent(identity),
    canRestore: () => apiActorIdentityIsCurrent(identity),
    generation,
  };
}
export type InboxStorageScope = ReturnType<typeof inboxStorageScope>;
function path(scope: InboxStorageScope, conversationId: string) {
  return `${directory}${scope.key}-${bytesToHex(sha256(utf8ToBytes(conversationId)))}.json`;
}
export function readConversationDraft(scope: InboxStorageScope, conversationId: string) {
  return enqueue(async (): Promise<ConversationDraft> => {
    if (!scope.current() || scope.generation !== generation) return { text: "", sends: [] };
    const file = path(scope, conversationId);
    if (!(await FileSystem.getInfoAsync(file)).exists) return { text: "", sends: [] };
    return parseDraft(await FileSystem.readAsStringAsync(file));
  });
}
export interface DraftAdmission {
  eligible(): boolean;
  rollback: ConversationDraft;
}
export function saveConversationDraft(
  scope: InboxStorageScope,
  conversationId: string,
  draft: ConversationDraft,
  admission?: DraftAdmission,
) {
  return enqueue(async () => {
    if (!scope.current() || scope.generation !== generation) return false;
    if (admission && !admission.eligible()) return false;
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    await FileSystem.writeAsStringAsync(path(scope, conversationId), JSON.stringify(draft));
    // Roll back before a queued remount can read an operation that never reached HTTP.
    if (admission && !admission.eligible()) {
      if (scope.canRestore() && scope.generation === generation)
        await FileSystem.writeAsStringAsync(
          path(scope, conversationId),
          JSON.stringify(admission.rollback),
        );
      return false;
    }
    return true;
  });
}
/** Restore only the definitely-undispatched operation, retaining any newer saved text or receipt. */
export function restoreUnsentConversationSend(
  scope: InboxStorageScope,
  conversationId: string,
  send: PendingSend,
  previous?: PendingSend,
) {
  return enqueue(async () => {
    if (!scope.canRestore() || scope.generation !== generation) return;
    const file = path(scope, conversationId);
    if (!(await FileSystem.getInfoAsync(file)).exists) return;
    const draft = parseDraft(await FileSystem.readAsStringAsync(file));
    const operation = draft.sends.find((row) => row.operationId === send.operationId);
    if (!operation || operation.serverId || !["sending", "ambiguous"].includes(operation.state))
      return draft;
    const restored: ConversationDraft = {
      ...draft,
      text: previous ? draft.text : [send.body, draft.text].filter(Boolean).join("\n"),
      sends: draft.sends.flatMap((row) =>
        row.operationId !== send.operationId ? [row] : previous ? [previous] : [],
      ),
    };
    await FileSystem.writeAsStringAsync(file, JSON.stringify(restored));
    return restored;
  });
}
export async function purgeInboxDeviceData() {
  generation++;
  await enqueue(() => FileSystem.deleteAsync(directory, { idempotent: true }));
}
export function newInboxOperationId() {
  return uuid.v4();
}
let clientId: string | undefined;
export function inboxClientId() {
  return (clientId ??= uuid.v4());
}
