/** UTF-8 byte offsets match the publication contract and provider facets. */
export interface MentionTarget {
  provider: "bluesky" | "mastodon" | "linkedin" | "workspace";
  kind: "person" | "page" | "profile";
  id: string;
  authority?: string;
  handle?: string;
  profiles?: MentionProfile[] | null;
}
export interface MentionProfile {
  provider: string;
  authority?: string;
  text: string;
  target?: NativeMentionTarget;
}
export interface NativeMentionTarget {
  provider: "bluesky" | "mastodon" | "linkedin";
  kind: "person" | "page";
  id: string;
  authority?: string;
  handle?: string;
}
export interface MentionMetadata {
  version: 1;
  spans: TextMention[];
}
export interface TextMention {
  start: number;
  end: number;
  text: string;
  target: MentionTarget;
}
export interface PostTextValue {
  body: string;
  mentions?: TextMention[];
}
export type StructuredPostTextValue = PostTextValue & { mentions: TextMention[] };
export interface MentionCandidate {
  label: string;
  detail: string;
  target: MentionTarget;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function mentionTarget(value: unknown, allowProfile = true): MentionTarget | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  const { provider, kind, id, authority, handle, profiles } = record;
  if (
    (provider !== "bluesky" &&
      provider !== "mastodon" &&
      provider !== "linkedin" &&
      provider !== "workspace") ||
    (kind !== "person" && kind !== "page" && kind !== "profile") ||
    typeof id !== "string" ||
    !id ||
    id.length > 2048 ||
    (authority !== undefined && typeof authority !== "string") ||
    (handle !== undefined && typeof handle !== "string")
  )
    return null;
  if (provider === "workspace") {
    if (
      !allowProfile ||
      kind !== "profile" ||
      authority ||
      handle ||
      !Array.isArray(profiles) ||
      !profiles.length ||
      profiles.length > 32
    )
      return null;
    const parsed: MentionProfile[] = [];
    const seen = new Set<string>();
    for (const profile of profiles) {
      if (
        !profile ||
        typeof profile.provider !== "string" ||
        !profile.provider ||
        profile.provider === "workspace" ||
        typeof profile.text !== "string" ||
        !profile.text.trim() ||
        [...profile.text].length > 512 ||
        (profile.authority !== undefined && typeof profile.authority !== "string")
      )
        return null;
      const target = profile.target === undefined ? undefined : nativeMentionTarget(profile.target);
      if (profile.target !== undefined && (!target || target.provider !== profile.provider))
        return null;
      const key = `${profile.provider}\u0000${profile.authority ?? ""}`;
      if (seen.has(key)) return null;
      seen.add(key);
      parsed.push({
        provider: profile.provider,
        text: profile.text,
        ...(profile.authority ? { authority: profile.authority } : {}),
        ...(target ? { target } : {}),
      });
    }
    return { provider, kind, id, profiles: parsed };
  }
  if (profiles !== undefined || kind === "profile") return null;
  return {
    provider,
    kind,
    id,
    ...(typeof authority === "string" ? { authority } : {}),
    ...(typeof handle === "string" ? { handle } : {}),
  };
}

export function nativeMentionTarget(value: unknown): NativeMentionTarget | null {
  const target = mentionTarget(value, false);
  if (!target || target.provider === "workspace" || target.kind === "profile") return null;
  return {
    provider: target.provider,
    kind: target.kind,
    id: target.id,
    ...(target.authority ? { authority: target.authority } : {}),
    ...(target.handle ? { handle: target.handle } : {}),
  };
}

/** Project only explicitly selected reusable mentions, leaving authored text intact. */
export function postTextForDestination(
  value: PostTextValue,
  provider: string,
  authority = "",
): PostTextValue {
  const input = validTextMentions(value.body, value.mentions);
  if (!input.some((span) => span.target.provider === "workspace")) return value;
  const bytes = encoder.encode(value.body);
  let body = "";
  let position = 0;
  const mentions: TextMention[] = [];
  const origin = (text = "") => text.replace(/\/$/, "").toLowerCase();
  for (const span of input) {
    body += decoder.decode(bytes.subarray(position, span.start));
    const mapping =
      span.target.provider === "workspace"
        ? span.target.profiles?.find(
            (profile) =>
              profile.provider === provider &&
              (!profile.authority || origin(profile.authority) === origin(authority)),
          )
        : undefined;
    const text = mapping?.text ?? span.text;
    const target = span.target.provider === "workspace" ? mapping?.target : span.target;
    const start = encoder.encode(body).length;
    body += text;
    if (target) mentions.push({ start, end: encoder.encode(body).length, text, target });
    position = span.end;
  }
  body += decoder.decode(bytes.subarray(position));
  return { body, mentions };
}

/** Reject stale, overlapping or partial Unicode annotations without changing text. */
export function validTextMentions(body: string, input: unknown): TextMention[] {
  if (!Array.isArray(input) || input.length > 50) return [];
  const bytes = encoder.encode(body);
  const result: TextMention[] = [];
  let previousEnd = 0;
  for (const value of input) {
    if (!value || typeof value !== "object") return [];
    const { start, end, text, target: rawTarget } = value;
    const target = mentionTarget(rawTarget);
    if (
      !target ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < previousEnd ||
      end <= start ||
      end > bytes.length ||
      typeof text !== "string"
    )
      return [];
    try {
      if (decoder.decode(bytes.subarray(start, end)) !== text) return [];
    } catch {
      return [];
    }
    result.push({ start, end, text, target });
    previousEnd = end;
  }
  return result;
}

export function readMentionMetadata(body: string, value: unknown): MentionMetadata | undefined {
  if (
    !value ||
    typeof value !== "object" ||
    !("version" in value) ||
    value.version !== 1 ||
    !("spans" in value) ||
    !Array.isArray(value.spans)
  )
    return undefined;
  const spans = validTextMentions(body, value.spans);
  return spans.length === value.spans.length ? { version: 1, spans } : undefined;
}

/** Body-only transforms retain identity only while every selected label stays unique. */
export function remapMentionMetadata(
  before: string,
  after: string,
  value?: MentionMetadata,
): MentionMetadata | undefined {
  if (!value || before === after) return value;
  if (!after) return { version: 1, spans: [] };
  const spans: TextMention[] = [];
  for (const span of value.spans) {
    const index = after.indexOf(span.text);
    if (
      index < 0 ||
      after.indexOf(span.text, index + span.text.length) !== -1 ||
      before.indexOf(span.text) !== before.lastIndexOf(span.text)
    )
      throw new Error("mention_metadata_required");
    const start = encoder.encode(after.slice(0, index)).length;
    spans.push({ ...span, start, end: start + encoder.encode(span.text).length });
  }
  spans.sort((a, b) => a.start - b.start);
  return { version: 1, spans };
}

/** Join authored sources using the publication separator, remapping byte ranges. */
export function joinPostText(values: readonly PostTextValue[]): PostTextValue {
  const spans: TextMention[] = [];
  let body = "";
  let annotated = false;
  for (const value of values) {
    annotated ||= value.mentions !== undefined;
    const text = value.body.trim();
    if (!text) continue;
    const prefix = encoder.encode(value.body.slice(0, value.body.indexOf(text))).length;
    if (body) body += "\n\n";
    const offset = encoder.encode(body).length;
    for (const span of value.mentions ?? []) {
      if (span.start < prefix || span.end > prefix + encoder.encode(text).length)
        throw new Error("mention_metadata_required");
      spans.push({ ...span, start: offset + span.start - prefix, end: offset + span.end - prefix });
    }
    body += text;
  }
  if (spans.length > 50) throw new Error("mention_limit");
  return annotated ? { body, mentions: spans } : { body };
}
