import { describe, expect, mock, test } from "bun:test";
import {
  activityPublicationsQueryOptions,
  liveQueryStaleTime,
  queryStaleTime,
  workspaceAccountsQueryOptions,
  type SocialAccount,
  type Workspace,
} from "@openpost/query-catalog";

mock.module("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));

const { accountsOptions, publicationActivityOptions, workspacesOptions } =
  await import("./queries");

describe("shared query definition parity", () => {
  test("uses the canonical keys and freshness for mobile publications and accounts", () => {
    const sharedScheduled = activityPublicationsQueryOptions(
      { listActivityPublications: async () => ({ items: [], total: 0, nextCursor: "" }) },
      "workspace-1",
      "scheduled",
      { limit: 100 },
    );
    const mobileScheduled = publicationActivityOptions("workspace-1", "scheduled");
    expect(mobileScheduled.queryKey as readonly unknown[]).toEqual(
      sharedScheduled.queryKey as readonly unknown[],
    );
    expect(mobileScheduled.staleTime).toBe(liveQueryStaleTime);
    expect(mobileScheduled.staleTime).toBe(sharedScheduled.staleTime);
    expect(mobileScheduled.retry).toBe(sharedScheduled.retry);

    const sharedAccounts = workspaceAccountsQueryOptions(
      { listAccounts: async () => [] },
      "workspace-1",
    );
    const mobileAccounts = accountsOptions("workspace-1");
    expect(mobileAccounts.queryKey as readonly unknown[]).toEqual(
      sharedAccounts.queryKey as readonly unknown[],
    );
    expect(mobileAccounts.staleTime).toBe(queryStaleTime);
    expect(mobileAccounts.staleTime).toBe(sharedAccounts.staleTime);
    expect(mobileAccounts.retry).toBe(sharedAccounts.retry);
  });
});

describe("mobile identity projections", () => {
  const accountFixture: SocialAccount = {
    id: "account-1",
    platform: "mastodon",
    slug: "masto-main",
    account_username: "opener",
    alias: "Main",
    account_avatar_url: "https://cdn.example.com/avatar.png",
    instance_url: "https://masto.example.com",
    is_active: true,
    account_id: "platform-1",
    grant_destination_count: 1,
    messages_enabled: false,
    messaging_supported: false,
    shared_grant: false,
    thread_replies_supported: true,
  };

  const workspaceFixture: Workspace = {
    id: "workspace-1",
    name: "Studio",
    avatar_url: "https://cdn.example.com/workspace.png",
    color: "#123456",
    can_approve: true,
    can_connect: true,
    can_edit: true,
    created_at: "2026-01-01T00:00:00Z",
    organization_id: "org-1",
    organization_name: "Org",
    role: "admin",
    sso_authenticated: true,
    sso_identity_linked: true,
    sso_required: false,
  };

  test("accounts projection keeps the identity fields the API returns", () => {
    const projected = accountsOptions("workspace-1").select?.([accountFixture]);
    expect(projected).toEqual([
      {
        id: "account-1",
        platform: "mastodon",
        slug: "masto-main",
        account_username: "opener",
        alias: "Main",
        account_avatar_url: "https://cdn.example.com/avatar.png",
        instance_url: "https://masto.example.com",
        is_active: true,
      },
    ]);
  });

  test("accounts projection passes is_active through instead of filtering rows", () => {
    const projected = accountsOptions("workspace-1").select?.([
      { ...accountFixture, id: "inactive-1", is_active: false },
    ]);
    expect(projected).toEqual([
      {
        id: "inactive-1",
        platform: "mastodon",
        slug: "masto-main",
        account_username: "opener",
        alias: "Main",
        account_avatar_url: "https://cdn.example.com/avatar.png",
        instance_url: "https://masto.example.com",
        is_active: false,
      },
    ]);
  });

  test("workspaces projection keeps avatar and color", () => {
    const projected = workspacesOptions().select?.([workspaceFixture]);
    expect(projected).toEqual([
      {
        id: "workspace-1",
        name: "Studio",
        avatar_url: workspaceFixture.avatar_url,
        color: "#123456",
      },
    ]);
  });
});
