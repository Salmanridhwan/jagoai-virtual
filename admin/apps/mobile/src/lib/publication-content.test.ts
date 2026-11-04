import { expect, test } from "bun:test";
import { publicationContentUpdate, publicationReadinessSegments } from "./publication-content";

const first = {
  id: "first",
  position: 0,
  body: "Before",
  title: "Title",
  description: "Description",
  url: "https://example.com",
  settings: { poll: { question: "Which?" } },
  media: [{ id: "photo", role: "attachment", alt_text: "A photo", settings: { crop: "square" } }],
};
const reply = {
  id: "reply",
  position: 1,
  body: "Keep this reply",
  title: "",
  description: "",
  settings: {},
  media: [{ id: "reply-photo", alt_text: "Reply photo" }],
};
const publication = { source_text: "Before", segments: [first, reply], media: first.media };

test("readiness checks unsaved later thread edits and explicit empty text with retained media", () => {
  for (const body of ["Short corrected reply", ""]) {
    const draft = {
      ...publication,
      segments: [first, { ...reply, body: "x".repeat(400) }],
    };
    expect(
      publicationReadinessSegments(draft, "Edited first post", ["new-photo"], {
        reply: { body },
      }),
    ).toEqual([
      { content: "Edited first post", mediaIds: ["new-photo"] },
      { content: body, mediaIds: ["reply-photo"] },
    ]);
  }
});

test("saves added photos on the first canonical segment and preserves the rest of the thread", () => {
  const update = publicationContentUpdate(publication, "Edited", ["photo", "new-photo"]);
  expect(update).toEqual({
    source_text: "Edited",
    segments: [
      {
        id: "first",
        body: "Edited",
        title: "Title",
        description: "Description",
        url: "https://example.com",
        settings: { poll: { question: "Which?" } },
        media: [
          {
            media_id: "photo",
            role: "attachment",
            alt_text: "A photo",
            settings: { crop: "square" },
          },
          { media_id: "new-photo" },
        ],
      },
      {
        id: "reply",
        body: "Keep this reply",
        title: "",
        description: "",
        settings: {},
        media: [{ media_id: "reply-photo", alt_text: "Reply photo" }],
      },
    ],
  });
});

test("explicitly removes photos and updates canonical text even without media changes", () => {
  expect(publicationContentUpdate(publication, "Edited", []).segments?.[0]?.media).toEqual([]);
  expect(publicationContentUpdate(publication, "Edited", ["photo"]).segments?.[0]?.body).toBe(
    "Edited",
  );
});

test("applies edited per-post alt text, including explicit empty overrides", () => {
  const update = publicationContentUpdate(
    publication,
    "Before",
    ["photo", "new-photo"],
    new Map([
      ["photo", ""],
      ["new-photo", "Fresh upload"],
    ]),
  );
  expect(update.segments?.[0]?.media).toEqual([
    {
      media_id: "photo",
      role: "attachment",
      alt_text: "",
      settings: { crop: "square" },
    },
    { media_id: "new-photo", alt_text: "Fresh upload" },
  ]);
  expect(update.segments?.[1]?.media).toEqual([
    { media_id: "reply-photo", alt_text: "Reply photo" },
  ]);
});

test("an alt-only edit still emits segments so the description is saved", () => {
  const update = publicationContentUpdate(
    publication,
    "Before",
    ["photo"],
    new Map([["photo", "Edited caption"]]),
  );
  expect(update.segments?.[0]?.media).toEqual([
    {
      media_id: "photo",
      role: "attachment",
      alt_text: "Edited caption",
      settings: { crop: "square" },
    },
  ]);
});

test("canonical thread edits keep byte ranges and explicit mention removal", () => {
  const target = {
    provider: "bluesky" as const,
    kind: "person" as const,
    id: "did:plc:ewvi7nxzyoun6zhxrhs64oiz",
  };
  const mentions = { version: 1 as const, spans: [{ start: 8, end: 14, text: "@alice", target }] };
  const source = { ...first, body: "🚀 Hi @alice", settings: { mentions } };
  const pub = {
    source_text: source.body,
    segments: [
      source,
      {
        ...reply,
        body: "@alice",
        settings: {
          mentions: { version: 1 as const, spans: [{ start: 0, end: 6, text: "@alice", target }] },
        },
      },
    ],
  };
  const update = publicationContentUpdate(pub, "A 🚀 Hi @alice", ["photo"], undefined, {
    reply: { body: "@alice", mentions: [] },
  });
  expect(update.segments?.[0]?.settings?.mentions).toEqual({
    version: 1,
    spans: [{ start: 10, end: 16, text: "@alice", target }],
  });
  expect(update.segments?.[1]?.settings?.mentions).toEqual({ version: 1, spans: [] });
});
