import { expect, test } from "bun:test";
import { rememberMentionClipboardTargets, knownMentionClipboardTarget } from "./mention-clipboard";
import type { TextMention } from "@openpost/platform-text/mentions";

test("clipboard trust includes every mapping in a saved mention snapshot", () => {
  const original: TextMention = {
    start: 0,
    end: 6,
    text: "@guest",
    target: {
      provider: "workspace",
      kind: "profile",
      id: "saved",
      profiles: [{ provider: "x", text: "@guest_x" }],
    },
  };
  rememberMentionClipboardTargets("workspace", [original]);
  expect(knownMentionClipboardTarget("workspace", original)).toBe(true);
  const changed: TextMention = {
    ...original,
    target: { ...original.target, profiles: [{ provider: "x", text: "@someone_else" }] },
  };
  expect(knownMentionClipboardTarget("workspace", changed)).toBe(false);
  expect(knownMentionClipboardTarget("another", original)).toBe(false);
});
