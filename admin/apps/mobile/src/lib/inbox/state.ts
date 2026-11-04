import type { DirectMessage } from "./api";

export interface PendingSend {
  operationId: string;
  body: string;
  createdAt: string;
  state: "sending" | "ambiguous" | "failed" | "queued" | "confirmed";
  serverId?: string;
  jobId?: string;
  error?: string;
}
export interface ConversationDraft {
  text: string;
  sends: PendingSend[];
  replyHistory?: PendingSend[];
}

/** Server identity wins, including a send receipt observed before its HTTP response. */
export function reconcileSends(
  sends: readonly PendingSend[],
  messages: readonly DirectMessage[],
): PendingSend[] {
  return sends.filter(
    (send) =>
      !messages.some(
        (message) =>
          message.id === send.serverId || message.client_operation_id === send.operationId,
      ),
  );
}

function recoverDraft(draft: ConversationDraft): ConversationDraft {
  return {
    text: draft.text,
    ...(draft.replyHistory?.length ? { replyHistory: draft.replyHistory } : {}),
    sends: draft.sends.map((send) =>
      send.state === "sending"
        ? {
            ...send,
            state: "ambiguous",
            error: "Delivery is unconfirmed. Retry safely with the same message.",
          }
        : send,
    ),
  };
}

export function uniqueMessages(
  pages: readonly { items: DirectMessage[] | null }[],
): DirectMessage[] {
  const messages = new Map<string, DirectMessage>();
  // Newest page is authoritative when history overlaps after a refresh.
  for (const page of [...pages].reverse())
    for (const message of page.items ?? []) messages.set(message.id, message);
  return [...messages.values()].sort(
    (a, b) =>
      Date.parse(b.remote_created_at || b.created_at) -
        Date.parse(a.remote_created_at || a.created_at) || b.id.localeCompare(a.id),
  );
}

export function parseDraft(value: string): ConversationDraft {
  const data: unknown = JSON.parse(value);
  if (
    !data ||
    typeof data !== "object" ||
    !("text" in data) ||
    typeof data.text !== "string" ||
    !("sends" in data) ||
    !Array.isArray(data.sends)
  )
    throw new Error("Invalid saved chat draft");
  const sends = parseOperations(data.sends);
  const history = "replyHistory" in data ? parseOperations(data.replyHistory) : [];
  return recoverDraft({
    text: data.text,
    sends,
    ...(history.length ? { replyHistory: history } : {}),
  });
}
function parseOperations(values: unknown): PendingSend[] {
  if (!Array.isArray(values)) return [];
  const sends: PendingSend[] = [];
  for (const send of values) {
    if (
      !send ||
      typeof send !== "object" ||
      typeof send.operationId !== "string" ||
      typeof send.body !== "string" ||
      typeof send.createdAt !== "string" ||
      !["sending", "ambiguous", "failed", "queued", "confirmed"].includes(send.state)
    )
      continue;
    // Construct validated values instead of treating arbitrary persisted JSON as a domain object.
    const state =
      send.state === "confirmed"
        ? "confirmed"
        : send.state === "queued"
          ? "queued"
          : send.state === "failed"
            ? "failed"
            : send.state === "sending"
              ? "sending"
              : "ambiguous";
    sends.push({
      operationId: send.operationId,
      body: send.body,
      createdAt: send.createdAt,
      state,
      jobId: typeof send.jobId === "string" ? send.jobId : undefined,
      serverId: typeof send.serverId === "string" ? send.serverId : undefined,
      error: typeof send.error === "string" ? send.error : undefined,
    });
  }
  return sends;
}
