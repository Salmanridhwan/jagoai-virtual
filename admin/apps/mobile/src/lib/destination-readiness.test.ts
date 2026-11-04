import { expect, test } from "bun:test";
import type { components } from "@openpost/api-contract";
import {
  destinationIssueMessages,
  destinationNeedsAttention,
  destinationPublishBlocker,
  effectiveAccountBody,
  firstPublishBlocker,
  readinessRequestSignature,
  resolveDestinationCapabilities,
} from "./destination-readiness";

type Capability = components["schemas"]["ResolvedAccountCapability"];
type Issue = components["schemas"]["ValidationIssue"];

function issue(partial: Partial<Issue> & { message: string }): Issue {
  return {
    severity: "error",
    code: "text_too_long",
    fallback_message: partial.message,
    ...partial,
  };
}

function capability(partial: Partial<Capability> = {}): Capability {
  return {
    account_id: "account-a",
    immediate_readiness: {
      state: "healthy",
      publishable: true,
    } as Capability["immediate_readiness"],
    scheduled_readiness: {
      state: "healthy",
      publishable: true,
    } as Capability["scheduled_readiness"],
    compatible: true,
    format_selection_required: false,
    segment_strategy: "preserve",
    available_formats: [],
    active_constraints: {},
    setting_groups: [],
    issues: [],
    provider: "x",
    profile: "short_text",
    output_profile: "x.post",
    intents: [],
    media_shapes: [],
    label: "X",
    native_scheduling: false,
    openpost_queued: false,
    requires_app_review: false,
    requires_public_media: false,
    media: {},
    content: {},
    capability_revision: "rev-1",
    ...partial,
  } as Capability;
}

test("row issues repeat the server validation wording once, without info notes", () => {
  const messages = destinationIssueMessages(
    capability({
      issues: [
        issue({ message: "Text is too long for X." }),
        issue({ message: "Text is too long for X." }),
        issue({ severity: "warning", code: "quota_warning", message: "Quota is nearly used." }),
        issue({ severity: "info", code: "note", message: "FYI only." }),
      ],
    }),
  );
  expect(messages).toEqual(["Text is too long for X.", "Quota is nearly used."]);
});

test("a ready destination needs no attention and blocks nothing", () => {
  const ready = capability();
  expect(destinationNeedsAttention(ready)).toBe(false);
  expect(destinationPublishBlocker(ready)).toBeNull();
});

test("warnings show on the row but do not block publishing", () => {
  const warned = capability({
    issues: [
      issue({ severity: "warning", code: "quota_warning", message: "Quota is nearly used." }),
    ],
  });
  expect(destinationNeedsAttention(warned)).toBe(true);
  expect(destinationIssueMessages(warned)).toEqual(["Quota is nearly used."]);
  expect(destinationPublishBlocker(warned)).toBeNull();
});

test("publish is blocked with the server error wording", () => {
  const blocked = capability({
    issues: [issue({ message: "Add an image before publishing to Instagram." })],
  });
  expect(destinationNeedsAttention(blocked)).toBe(true);
  expect(destinationPublishBlocker(blocked)).toBe("Add an image before publishing to Instagram.");
});

test("an incompatible destination without issues needs attention but adds no wording", () => {
  const incompatible = capability({ compatible: false });
  expect(destinationNeedsAttention(incompatible)).toBe(true);
  expect(destinationPublishBlocker(incompatible)).toBeNull();
});

test("unpublishable readiness blocks with the server reason when one exists", () => {
  const reconnect = capability({
    immediate_readiness: {
      state: "reconnect_required",
      publishable: false,
    } as Capability["immediate_readiness"],
    unavailable_reason: "Reconnect this account to publish.",
  });
  expect(destinationNeedsAttention(reconnect)).toBe(true);
  expect(destinationPublishBlocker(reconnect)).toBe("Reconnect this account to publish.");
});

test("the first blocker across destinations wins, in selection order", () => {
  const byAccount = {
    "account-a": capability(),
    "account-b": capability({
      account_id: "account-b",
      issues: [issue({ message: "Second problem." })],
    }),
    "account-c": capability({
      account_id: "account-c",
      issues: [issue({ message: "First problem." })],
    }),
  };
  expect(firstPublishBlocker(byAccount, ["account-a", "account-b", "account-c"])).toBe(
    "Second problem.",
  );
  expect(firstPublishBlocker(byAccount, ["account-a"])).toBeNull();
});

test("the request signature ignores account order but tracks text and media", () => {
  const base = {
    accountIds: ["account-a", "account-b"],
    segments: [{ content: "Hello", mediaIds: ["media-1"] }],
  };
  expect(readinessRequestSignature({ ...base, accountIds: ["account-b", "account-a"] })).toBe(
    readinessRequestSignature(base),
  );
  expect(
    readinessRequestSignature({
      ...base,
      segments: [{ content: "Hello!", mediaIds: ["media-1"] }],
    }),
  ).not.toBe(readinessRequestSignature(base));
  expect(
    readinessRequestSignature({ ...base, segments: [{ content: "Hello", mediaIds: [] }] }),
  ).not.toBe(readinessRequestSignature(base));
});

test("per-account text joins the edited destination fields", () => {
  expect(effectiveAccountBody([{ key: "body", value: "Shared draft" }], undefined)).toBe(
    "Shared draft",
  );
  expect(
    effectiveAccountBody(
      [
        { key: "segment:0", value: "First" },
        { key: "segment:1", value: "Second" },
      ],
      { "segment:1": "Custom second" },
    ),
  ).toBe("First\n\nCustom second");
  expect(effectiveAccountBody([{ key: "body", value: "  " }], undefined)).toBe("");
});

test("resolution posts the authored segments and maps capabilities by account", async () => {
  const replies: Capability[] = [
    capability({ account_id: "account-a" }),
    capability({ account_id: "account-b", issues: [issue({ message: "Too long." })] }),
  ];
  let receivedBody: unknown;
  const transport = {
    POST: (async (_path: string, options: { body: unknown }) => {
      receivedBody = options.body;
      return { data: { accounts: replies }, error: undefined };
    }) as never,
  };
  const byAccount = await resolveDestinationCapabilities(
    transport,
    {
      accountIds: ["account-a", "account-b"],
      segments: [{ content: "Hello", mediaIds: ["media-1"] }],
      accountSegments: { "account-b": [{ content: "Custom", mediaIds: [] }] },
    },
    new AbortController().signal,
  );
  expect(Object.keys(byAccount).sort()).toEqual(["account-a", "account-b"]);
  expect(byAccount["account-b"].issues?.[0]?.message).toBe("Too long.");
  expect(receivedBody).toMatchObject({
    account_ids: ["account-a", "account-b"],
    segments: [{ id: "composer-0", content: "Hello", media: [{ media_id: "media-1" }] }],
    account_segments: { "account-b": [{ id: "composer-0", content: "Custom", media: [] }] },
  });
});

test("resolution failures stay generic so the composer can keep editing", async () => {
  const transport = {
    POST: (async () => ({ data: undefined, error: { message: "nope" } })) as never,
  };
  await expect(
    resolveDestinationCapabilities(transport, { accountIds: ["account-a"], segments: [] }),
  ).rejects.toThrow("Could not check destination readiness");
});
