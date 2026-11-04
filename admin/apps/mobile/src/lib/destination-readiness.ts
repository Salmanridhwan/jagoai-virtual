import type { components } from "@openpost/api-contract";
import type { TextMention } from "@openpost/platform-text/mentions";

import type { Api } from "./api/client";

export type ResolvedDestinationCapability = components["schemas"]["ResolvedAccountCapability"];
type CapabilityValidationIssue = components["schemas"]["ValidationIssue"];
type ResolveSegmentInput = components["schemas"]["ResolveCapabilitySegmentInput"];
type ReadinessDecision = ResolvedDestinationCapability["immediate_readiness"];

export type ReadinessSegment = {
  content: string;
  mediaIds: string[];
  mentions?: TextMention[];
};

export type ReadinessRequestInput = {
  accountIds: string[];
  segments: ReadinessSegment[];
  accountSegments?: Record<string, ReadinessSegment[]>;
};

export type ReadinessTextField = {
  key: string;
  value: string;
};

type ResolveTransport = Pick<Api, "POST">;

const READINESS_DEBOUNCE_MS = 300;

export function readinessDebounceMs(): number {
  return READINESS_DEBOUNCE_MS;
}

function readinessSegmentsInput(segments: ReadinessSegment[]): ResolveSegmentInput[] {
  return segments.map((segment, index) => ({
    id: `composer-${index}`,
    content: segment.content,
    media: segment.mediaIds.map((mediaId) => ({ media_id: mediaId })),
  }));
}

/**
 * Stable signature of the selected destinations and authored segments so
 * resolution can be debounced and deduplicated instead of running per
 * keystroke. Account order does not change the signature.
 */
export function readinessRequestSignature(input: ReadinessRequestInput): string {
  return JSON.stringify({
    accounts: [...input.accountIds].sort(),
    segments: input.segments,
    accountSegments: Object.fromEntries(
      Object.entries(input.accountSegments ?? {}).sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
    ),
  });
}

/** Effective destination text: shared fields with per-account edits applied. */
export function effectiveAccountBody(
  fields: readonly ReadinessTextField[],
  edits: Readonly<Record<string, string>> | undefined,
): string {
  return fields
    .map((field) => (edits?.[field.key] ?? field.value).trim())
    .filter(Boolean)
    .join("\n\n");
}

function actionableIssueMessages(capability: ResolvedDestinationCapability): string[] {
  const messages = (capability.issues ?? [])
    .filter((issue: CapabilityValidationIssue) => issue.severity !== "info")
    .map((issue: CapabilityValidationIssue) => issue.message?.trim())
    .filter((message): message is string => Boolean(message));
  return [...new Set(messages)];
}

function decisionPublishable(decision: ReadinessDecision | null | undefined): boolean {
  if (!decision) return true;
  return decision.publishable === true;
}

function readinessBlocked(capability: ResolvedDestinationCapability): boolean {
  return (
    !decisionPublishable(capability.immediate_readiness) ||
    !decisionPublishable(capability.scheduled_readiness)
  );
}

/**
 * Verbatim server validation wording for the destination row. The messages
 * come from POST /capabilities/resolve, the same source web uses, so mobile
 * and web never disagree about the same post.
 */
export function destinationIssueMessages(capability: ResolvedDestinationCapability): string[] {
  return actionableIssueMessages(capability);
}

export function destinationNeedsAttention(capability: ResolvedDestinationCapability): boolean {
  if (actionableIssueMessages(capability).length > 0) return true;
  if (!capability.compatible) return true;
  return readinessBlocked(capability);
}

/**
 * Error wording that must block publishing, or null when publishing may
 * proceed and the server stays authoritative. Warnings are a signal only.
 */
export function destinationPublishBlocker(
  capability: ResolvedDestinationCapability,
): string | null {
  const firstError = (capability.issues ?? []).find(
    (issue: CapabilityValidationIssue) =>
      issue.severity === "error" && Boolean(issue.message?.trim()),
  );
  if (firstError?.message) return firstError.message.trim();
  if (!capability.compatible || readinessBlocked(capability)) {
    const reason = capability.unavailable_reason?.trim();
    return reason ? reason : null;
  }
  return null;
}

export function firstPublishBlocker(
  byAccount: Record<string, ResolvedDestinationCapability>,
  accountIds: readonly string[],
): string | null {
  for (const accountId of accountIds) {
    const capability = byAccount[accountId];
    if (!capability) continue;
    const blocker = destinationPublishBlocker(capability);
    if (blocker) return blocker;
  }
  return null;
}

/**
 * Read-only resolver wrapper around POST /capabilities/resolve, the same
 * authoritative source web resolves per-destination capability and readiness
 * from. No stored state, schema, or permission change; no social-provider
 * network calls beyond what the resolver itself performs.
 */
export async function resolveDestinationCapabilities(
  transport: ResolveTransport,
  input: ReadinessRequestInput,
  signal?: AbortSignal,
): Promise<Record<string, ResolvedDestinationCapability>> {
  const accountSegments = Object.fromEntries(
    Object.entries(input.accountSegments ?? {})
      .filter(([, segments]) => segments.length > 0)
      .map(([accountId, segments]) => [accountId, readinessSegmentsInput(segments)]),
  );
  const { data, error } = await transport.POST("/capabilities/resolve", {
    ...(signal ? { signal } : {}),
    body: {
      account_ids: input.accountIds,
      segments: readinessSegmentsInput(input.segments),
      ...(Object.keys(accountSegments).length > 0 ? { account_segments: accountSegments } : {}),
    },
  });
  if (error || !data) throw new Error("Could not check destination readiness");
  return Object.fromEntries(
    (data.accounts ?? []).map((capability) => [capability.account_id, capability]),
  );
}
