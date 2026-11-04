import type { HttpClient } from "../client.js";
import type { EngagementPage, EngagementDetail, RefreshCapabilityOutcome } from "../types.js";

export interface InboxFilters {
  workspace_id: string;
  kind?: "comment" | "mention" | "review";
  platform?: string;
  account_id?: string;
  publication_id?: string;
  archived?: boolean;
}

export interface InboxListQuery extends InboxFilters {
  unread_only?: boolean;
  limit?: number;
  cursor?: string;
}

export interface InboxActionInput {
  workspace_id: string;
  action: "reply" | "delete_reply" | "hide" | "delete" | "like" | "unlike";
  message?: string;
  client_operation_id: string;
}

export class Inbox {
  constructor(private readonly http: HttpClient) {}

  async list(query: InboxListQuery): Promise<EngagementPage> {
    return (await this.http.get("/api/v1/engagement", { query: { ...query } })) as EngagementPage;
  }

  async get(workspaceId: string, itemId: string): Promise<EngagementDetail> {
    return (await this.http.get(`/api/v1/engagement/${encodeURIComponent(itemId)}`, {
      query: { workspace_id: workspaceId },
    })) as EngagementDetail;
  }

  async refresh(workspaceId: string): Promise<RefreshCapabilityOutcome> {
    return (await this.http.post("/api/v1/engagement/refresh", {
      workspace_id: workspaceId,
    })) as RefreshCapabilityOutcome;
  }

  async setState(input: {
    workspace_id: string;
    ids: string[];
    read?: boolean;
    archived?: boolean;
  }): Promise<void> {
    await this.http.post("/api/v1/engagement/state", input);
  }

  async markRead(filters: InboxFilters): Promise<{ updated_count: number }> {
    return (await this.http.post("/api/v1/engagement/read", filters)) as { updated_count: number };
  }

  // Queue a durable action. Wait for its job before replacing another review
  // reply, then read the item to inspect its separate moderation state.
  async act(itemId: string, input: InboxActionInput): Promise<{ job_id: string }> {
    return (await this.http.post(
      `/api/v1/engagement/${encodeURIComponent(itemId)}/actions`,
      input,
    )) as { job_id: string };
  }
}
