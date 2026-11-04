import type { JSONContent } from "@tiptap/core";
import {
  validTextMentions,
  mentionTarget,
  type PostTextValue,
  type StructuredPostTextValue,
} from "@openpost/platform-text/mentions";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
export function postTextDocument(value: PostTextValue): JSONContent {
  const bytes = encoder.encode(value.body);
  const content: JSONContent[] = [];
  let offset = 0;
  function appendText(text: string) {
    text.split("\n").forEach((line, index) => {
      if (index) content.push({ type: "hardBreak" });
      if (line) content.push({ type: "text", text: line });
    });
  }
  for (const mention of validTextMentions(value.body, value.mentions)) {
    appendText(decoder.decode(bytes.subarray(offset, mention.start)));
    content.push({
      type: "mention",
      attrs: { id: mention.target.id ?? "mention", label: mention.text, identity: mention.target },
    });
    offset = mention.end;
  }
  appendText(decoder.decode(bytes.subarray(offset)));
  return { type: "doc", content: [{ type: "paragraph", content }] };
}

export function postTextValue(document: JSONContent): StructuredPostTextValue {
  let body = "";
  let bytes = 0;
  let paragraphs = 0;
  const mentions: StructuredPostTextValue["mentions"] = [];
  function append(text: string) {
    body += text;
    bytes += encoder.encode(text).length;
  }
  function visit(node: JSONContent) {
    if (node.type === "paragraph" && paragraphs++) append("\n");
    if (node.type === "hardBreak") append("\n");
    if (node.type === "text" && typeof node.text === "string") append(node.text);
    if (node.type === "mention" && typeof node.attrs?.label === "string") {
      const start = bytes;
      const target = mentionTarget(node.attrs.identity);
      append(node.attrs.label);
      if (target) mentions.push({ start, end: bytes, text: node.attrs.label, target });
    }
    node.content?.forEach(visit);
  }
  visit(document);
  return { body, mentions };
}
