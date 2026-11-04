import { expect, it } from "vitest";
import {
  joinPostText,
  postTextForDestination,
  readMentionMetadata,
  type MentionTarget,
} from "./mentions";

it("projects reusable snapshots by selected UTF-8 spans through a joined thread", () => {
  const target: MentionTarget = {
    provider: "workspace",
    kind: "profile",
    id: "guest",
    profiles: [
      { provider: "x", text: "@guest_x" },
      {
        provider: "bluesky",
        text: "@guest.bsky.social",
        target: { provider: "bluesky", kind: "person", id: "did:plc:ewvi7nxzyoun6zhxrhs64oiz" },
      },
    ],
  };
  const shared = joinPostText([
    { body: " 🚀 Hi @guest ", mentions: [{ start: 9, end: 15, text: "@guest", target }] },
    { body: "@guest is plain" },
  ]);
  expect(postTextForDestination(shared, "x")).toEqual({
    body: "🚀 Hi @guest_x\n\n@guest is plain",
    mentions: [],
  });
  expect(postTextForDestination(shared, "youtube")).toEqual({
    body: "🚀 Hi @guest\n\n@guest is plain",
    mentions: [],
  });
  const bsky = postTextForDestination(shared, "bluesky");
  expect(bsky.body).toBe("🚀 Hi @guest.bsky.social\n\n@guest is plain");
  expect(bsky.mentions).toEqual([
    {
      start: 8,
      end: 26,
      text: "@guest.bsky.social",
      target: { provider: "bluesky", kind: "person", id: "did:plc:ewvi7nxzyoun6zhxrhs64oiz" },
    },
  ]);
  expect(
    readMentionMetadata(shared.body, { version: 1, spans: shared.mentions })?.spans[0].target,
  ).toEqual(target);
});
