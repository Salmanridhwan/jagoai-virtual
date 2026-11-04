import { parseDocument } from "htmlparser2";
import {
  mentionTarget,
  validTextMentions,
  remapMentionMetadata,
  type PostTextValue,
  type StructuredPostTextValue,
} from "@openpost/platform-text/mentions";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const escapeHTML = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

/** Private native-editor projection. HTML never crosses the publication API. */
export function nativePostHTML(value: PostTextValue): string {
  const bytes = encoder.encode(value.body);
  let html = "";
  let offset = 0;
  for (const span of validTextMentions(value.body, value.mentions)) {
    html += escapeHTML(decoder.decode(bytes.subarray(offset, span.start)));
    const identity = encodeURIComponent(JSON.stringify(span.target));
    html += `<mention text="${escapeHTML(span.text)}" indicator="@" identity="${identity}">${escapeHTML(span.text)}</mention>`;
    offset = span.end;
  }
  html += escapeHTML(decoder.decode(bytes.subarray(offset)));
  return `<p>${html.replaceAll("\n", "<br>")}</p>`;
}

type NativeNode = ReturnType<typeof parseDocument>["children"][number];
const blockTags = new Set(["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li"]);
export function nativePostValue(
  html: string,
  plainText?: string,
  scope?: { platform?: string; authority?: string },
): StructuredPostTextValue {
  if (html.length > 1024 * 1024) throw new Error("editor_content_too_large");
  let body = "";
  let bytes = 0;
  let blocks = 0;
  const mentions: StructuredPostTextValue["mentions"] = [];
  function append(text: string) {
    body += text;
    bytes += encoder.encode(text).length;
  }
  function visit(node: NativeNode, inText = false) {
    if (node.type === "text" && "data" in node) {
      if (inText || node.data.trim()) append(node.data);
      return;
    }
    if (!("name" in node) || !("children" in node)) return;
    if (node.name === "script" || node.name === "style") return;
    if (node.name === "br") {
      append("\n");
      return;
    }
    const block =
      blockTags.has(node.name) &&
      !node.children.some((child) => "name" in child && blockTags.has(child.name));
    if (block && blocks++) append("\n");
    const start = bytes;
    node.children.forEach((child) => visit(child, inText || block || node.name === "mention"));
    if (node.name !== "mention" || bytes <= start) return;
    try {
      const target = mentionTarget(JSON.parse(decodeURIComponent(node.attribs.identity ?? "")));
      if (target)
        mentions.push({
          start,
          end: bytes,
          text: decoder.decode(encoder.encode(body).subarray(start)),
          target,
        });
    } catch {}
  }
  parseDocument(html, { decodeEntities: true }).children.forEach((node) => visit(node));
  if (mentions.length > 50) throw new Error("mention_limit");
  const parsed = {
    body,
    mentions: validTextMentions(
      body,
      mentions.sort((a, b) => a.start - b.start),
    ),
  };
  if (
    scope?.platform &&
    parsed.mentions.some(
      (span) =>
        (span.target.provider !== "workspace" && span.target.provider !== scope.platform) ||
        (span.target.provider === "mastodon" &&
          span.target.authority?.replace(/\/$/, "").toLowerCase() !==
            scope.authority?.replace(/\/$/, "").toLowerCase()),
    )
  )
    throw new Error("wrong_network");
  if (plainText === undefined || plainText === body) return parsed;
  // Native HTML can omit a final paragraph break. Plain text owns exact content.
  if (plainText.startsWith(body) && /^\n*$/.test(plainText.slice(body.length)))
    return { ...parsed, body: plainText };
  const remapped = remapMentionMetadata(body, plainText, { version: 1, spans: parsed.mentions });
  return { body: plainText, mentions: remapped?.spans ?? [] };
}

/** A direct edit inside a token removes its identity; surrounding edits shift it. */
export function nativePostTextChange(before: PostTextValue, body: string): PostTextValue {
  const left = encoder.encode(before.body),
    right = encoder.encode(body);
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < left.length - prefix &&
    suffix < right.length - prefix &&
    left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  )
    suffix++;
  const delta = right.length - left.length;
  const mentions = (before.mentions ?? []).flatMap((span) =>
    span.end <= prefix
      ? [span]
      : span.start >= left.length - suffix
        ? [{ ...span, start: span.start + delta, end: span.end + delta }]
        : [],
  );
  return before.mentions === undefined
    ? { body }
    : { body, mentions: validTextMentions(body, mentions) };
}
