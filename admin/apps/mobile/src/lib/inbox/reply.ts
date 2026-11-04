import type { DraftAdmission } from "./storage";
import type { ConversationDraft, PendingSend } from "./state";

type ReplyJob = { id: string; status: string; last_error?: string };
interface ReplySnapshot {
  ready: boolean;
  text: string;
  operation: PendingSend | null;
  history: PendingSend[];
  error?: string;
}
interface ReplyDependencies {
  action?: "reply" | "delete_reply";
  read(): Promise<ConversationDraft>;
  write(draft: ConversationDraft, admission?: DraftAdmission): Promise<boolean | void>;
  admit(body: string, operationId: string): Promise<{ job_id?: string }>;
  newOperationId(): string;
  canEdit(): boolean;
  online(): boolean;
  current(): boolean;
}
/** Owns admission, crash recovery and receipts for a public reply or its removal. */
export class PublicReplySession {
  private value: ReplySnapshot = { ready: false, text: "", operation: null, history: [] };
  private listeners = new Set<() => void>();
  private inFlight = false;
  private active = true;
  private allowed: boolean | undefined;
  setAccess(canEdit: boolean, active: boolean) {
    this.allowed = canEdit;
    this.active = active;
  }
  private current() {
    return this.active && this.dependencies.current();
  }
  constructor(private readonly dependencies: ReplyDependencies) {}
  snapshot = () => this.value;
  // Passed to useSyncExternalStore by the public-reply hook.
  // fallow-ignore-next-line unused-class-member
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit(value: ReplySnapshot) {
    if (!this.current()) return;
    this.value = value;
    for (const listener of this.listeners) listener();
  }
  private async persist(
    update: Omit<ReplySnapshot, "history"> & { history?: PendingSend[] },
    admission?: DraftAdmission,
  ) {
    const value: ReplySnapshot = { ...update, history: update.history ?? this.value.history };
    if (!this.current()) return;
    const saved = await this.dependencies.write(
      {
        text: value.text,
        sends: value.operation ? [value.operation] : [],
        ...(value.history.length ? { replyHistory: value.history } : {}),
      },
      admission,
    );
    if (saved === false) return false;
    this.emit(value);
    return true;
  }
  async restore() {
    try {
      const draft = await this.dependencies.read();
      this.emit({
        ready: true,
        text: draft.text,
        operation: draft.sends[0] ?? null,
        history: draft.replyHistory ?? [],
      });
    } catch {
      this.emit({
        ...this.value,
        error: "Could not restore the saved reply. Reopen this comment.",
      });
    }
  }
  async setText(text: string) {
    if (!this.value.ready || (this.value.operation && this.value.operation.state !== "confirmed"))
      return;
    const next: ReplySnapshot = { ready: true, text, operation: null, history: this.value.history };
    this.emit(next);
    try {
      await this.dependencies.write({
        text,
        sends: [],
        ...(next.history.length ? { replyHistory: next.history } : {}),
      });
    } catch {
      this.emit({
        ...this.value,
        error: "Could not save this reply. Keep this screen open and try again.",
      });
    }
  }
  async startNewReply(text?: string) {
    const operation = this.value.operation;
    if (
      !this.current() ||
      !(this.allowed ?? this.dependencies.canEdit()) ||
      !operation?.jobId ||
      (operation.state !== "failed" && operation.state !== "confirmed") ||
      this.inFlight
    )
      return;
    // A deliberate new intent retains the old receipt and allocates a new UUID on Send.
    await this.persist({
      ready: true,
      text: text ?? (operation.state === "failed" ? operation.body : ""),
      operation: null,
      history: [...this.value.history, operation],
    }).catch(() =>
      this.emit({
        ...this.value,
        error:
          "Could not save the failed receipt. Reopen this comment before starting another reply.",
      }),
    );
  }
  async submit() {
    if (
      !this.value.ready ||
      !this.dependencies.online() ||
      !(this.allowed ?? this.dependencies.canEdit()) ||
      !this.current() ||
      this.inFlight
    )
      return;
    const prior = this.value.operation;
    if (prior?.jobId || prior?.state === "failed" || prior?.state === "confirmed") return;
    const body = prior?.body ?? this.value.text.trim();
    if (!body && this.dependencies.action !== "delete_reply") return;
    const operation: PendingSend = {
      ...prior,
      operationId: prior?.operationId ?? this.dependencies.newOperationId(),
      body,
      createdAt: prior?.createdAt ?? new Date().toISOString(),
      state: "sending",
    };
    const before = this.value;
    this.inFlight = true;
    this.emit({ ready: true, text: body, operation, history: before.history });
    try {
      const saved = await this.persist(
        { ready: true, text: body, operation },
        {
          eligible: () => this.current() && this.dependencies.online(),
          rollback: {
            text: before.text,
            sends: before.operation ? [before.operation] : [],
            ...(before.history.length ? { replyHistory: before.history } : {}),
          },
        },
      );
      if (saved === false) {
        this.emit(before);
        return;
      }
      if (!this.current()) return;
      if (!this.dependencies.online()) {
        await this.persist(before);
        return;
      }
      const receipt = await this.dependencies.admit(body, operation.operationId);
      if (!receipt.job_id) throw new Error("The server did not confirm a durable reply receipt.");
      if (!this.current()) return;
      await this.persist({
        ready: true,
        text: body,
        operation: { ...operation, state: "queued", jobId: receipt.job_id },
      });
    } catch (error) {
      if (!this.current()) return;
      await this.persist({
        ready: true,
        text: body,
        operation: { ...operation, state: "ambiguous" },
        error:
          error instanceof Error
            ? error.message
            : "Delivery could not be confirmed. Retry safely with the same reply.",
      }).catch(() =>
        this.emit({
          ...this.value,
          error: "Could not save the reply receipt. Reopen this comment before retrying.",
        }),
      );
    } finally {
      this.inFlight = false;
    }
  }
  async observe(job: ReplyJob) {
    const operation = this.value.operation;
    if (!operation || operation.jobId !== job.id || !this.current()) return;
    const state =
      job.status === "completed" ? "confirmed" : job.status === "failed" ? "failed" : undefined;
    if (!state || operation.state === state) return;
    await this.persist({
      ready: true,
      text: state === "confirmed" ? "" : operation.body,
      operation: {
        ...operation,
        state,
        error:
          state === "failed"
            ? job.last_error ||
              "The network did not confirm this reply. Check the thread before writing another."
            : undefined,
      },
    }).catch(() =>
      this.emit({
        ...this.value,
        error:
          "Could not save the delivery result. Check delivery status before writing another reply.",
      }),
    );
  }
}
