import { expect, test } from "bun:test";
import { nativePostHTML, nativePostValue, nativePostTextChange } from "./post-editor-value";
import type { StructuredPostTextValue } from "@openpost/platform-text/mentions";
const target = {
  provider: "bluesky" as const,
  kind: "person" as const,
  id: "did:plc:ewvi7nxzyoun6zhxrhs64oiz",
};
test("native HTML layout whitespace does not enter authored text, and plain text retains the trailing break", () => {
  const html = `<html>\n<p>🚀 <mention indicator="@" identity="${encodeURIComponent(JSON.stringify(target))}">@alice</mention></p>\n<br>\n<p>last</p>\n</html>`;
  expect(nativePostValue(html, "🚀 @alice\n\nlast\n")).toEqual({
    body: "🚀 @alice\n\nlast\n",
    mentions: [{ start: 5, end: 11, text: "@alice", target }],
  });
});
test("native editor projection escapes markup and preserves selected Unicode labels and blank lines", () => {
  const text = 'Acme "<R&D>"';
  const value: StructuredPostTextValue = {
    body: `\n${text}\n\n`,
    mentions: [
      {
        start: 1,
        end: 13,
        text,
        target: { provider: "linkedin", kind: "page", id: "urn:li:organization:123" },
      },
    ],
  };
  expect(nativePostHTML(value)).toContain("&lt;R&amp;D&gt;");
  expect(nativePostValue(nativePostHTML(value), value.body)).toEqual(value);
});
test("editing a selected token removes its identity while edits before it shift UTF-8 ranges", () => {
  const value: StructuredPostTextValue = {
    body: "Hi @alice",
    mentions: [{ start: 3, end: 9, text: "@alice", target }],
  };
  expect(nativePostTextChange(value, "🚀 Hi @alice")).toEqual({
    body: "🚀 Hi @alice",
    mentions: [{ start: 8, end: 14, text: "@alice", target }],
  });
  expect(nativePostTextChange(value, "Hi @alex")).toEqual({ body: "Hi @alex", mentions: [] });
});

test("native account edits retain saved profiles while direct Mastodon identities remain instance-scoped", () => {
  const value: StructuredPostTextValue = {
    body: "Hi @guest",
    mentions: [
      {
        start: 3,
        end: 9,
        text: "@guest",
        target: {
          provider: "workspace",
          kind: "profile",
          id: "saved",
          profiles: [{ provider: "x", text: "@guest_x" }],
        },
      },
    ],
  };
  expect(
    nativePostValue(nativePostHTML(value), value.body, {
      platform: "mastodon",
      authority: "https://social.example",
    }),
  ).toEqual(value);
  const direct: StructuredPostTextValue = {
    body: "@guest@social.example",
    mentions: [
      {
        start: 0,
        end: 21,
        text: "@guest@social.example",
        target: {
          provider: "mastodon",
          kind: "person",
          id: "42",
          authority: "https://social.example",
          handle: "guest@social.example",
        },
      },
    ],
  };
  expect(() =>
    nativePostValue(nativePostHTML(direct), direct.body, {
      platform: "mastodon",
      authority: "https://other.example",
    }),
  ).toThrow("wrong_network");
});
