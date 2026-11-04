import { expect, it } from "vitest";
import { OpenPost } from "../index";

it("retains native review context and sends scoped filters and stable reply intents", async () => {
  const calls: { url: URL; method: string; body: unknown }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    });
    if (url.pathname.endsWith("/actions")) return Response.json({ job_id: "durable-reply" });
    if (url.pathname.endsWith("/read")) return Response.json({ updated_count: 142 });
    return Response.json({
      items: [
        {
          id: "review",
          kind: "review",
          subject: {
            kind: "review",
            remote_id: "accounts/1/locations/2/reviews/3",
            review: {
              anonymous: true,
              stars: 5,
              owner_reply: {
                text: "Thanks 日本語",
                state: "PENDING",
                policy_violation: "FUTURE_POLICY",
              },
            },
          },
        },
      ],
      total: 1,
      sync_states: [],
      next_cursor: "opaque+next",
    });
  };
  const client = new OpenPost({ baseUrl: "https://example.test", token: "test-token", fetch });
  const page = await client.inbox.list({
    workspace_id: "workspace",
    kind: "review",
    account_id: "location",
    cursor: "opaque&previous",
  });
  expect(page.items?.[0]?.subject?.review?.owner_reply).toMatchObject({
    text: "Thanks 日本語",
    state: "PENDING",
    policy_violation: "FUTURE_POLICY",
  });
  expect(calls[0]?.url.searchParams.get("cursor")).toBe("opaque&previous");
  expect(calls[0]?.url.searchParams.get("kind")).toBe("review");
  expect(calls[0]?.body).toBeNull();
  expect(
    await client.inbox.markRead({
      workspace_id: "workspace",
      kind: "mention",
      account_id: "account",
      archived: true,
    }),
  ).toEqual({ updated_count: 142 });
  expect(calls[1]?.body).toEqual({
    workspace_id: "workspace",
    kind: "mention",
    account_id: "account",
    archived: true,
  });
  const receipt = await client.inbox.act("review/id", {
    workspace_id: "workspace",
    action: "reply",
    message: "Thanks 日本語",
    client_operation_id: "stable-intent",
  });
  expect(receipt.job_id).toBe("durable-reply");
  expect(calls[2]?.url.pathname).toBe("/api/v1/engagement/review%2Fid/actions");
  expect(calls[2]?.body).toEqual({
    workspace_id: "workspace",
    action: "reply",
    message: "Thanks 日本語",
    client_operation_id: "stable-intent",
  });
});
