import { expect, test } from "bun:test";
import type { components } from "@openpost/api-contract";
import {
  attachmentRequirement,
  mobileRenditionInput,
  mobileRenditionTextFields,
  mobileRenditionTextValue,
  mobileRenditionGeneratedText,
} from "./publication-renditions";

test("a new annotated destination retains every source and inherited media", () => {
  const publication: Pick<components["schemas"]["PublicationResponse"], "renditions" | "segments"> =
    {
      renditions: [],
      segments: [
        {
          id: "first",
          position: 0,
          body: "Hello",
          title: "",
          description: "",
          settings: {},
          media: [],
        },
        {
          id: "tail",
          position: 1,
          body: "Continuation",
          title: "",
          description: "",
          settings: {},
          media: [
            {
              id: "tail-image",
              mime_type: "image/png",
              url: "/media/tail",
              original_filename: "tail.png",
              analysis_status: "ready",
              alt_text: "Original tail image",
              aspect_ratio: "1:1",
              dominant_type: "image",
              duration_ms: 0,
              frame_rate: 0,
              height: 100,
              width: 100,
              size: 100,
              public_url_ready: false,
              public_url_status: 0,
            },
          ],
        },
      ],
    };
  const selected = {
    body: "Hi @alice",
    mentions: [
      {
        start: 3,
        end: 9,
        text: "@alice",
        target: {
          provider: "bluesky" as const,
          kind: "person" as const,
          id: "did:plc:ewvi7nxzyoun6zhxrhs64oiz",
        },
      },
    ],
  };
  const input = mobileRenditionInput(publication, "new-account", { body: selected.body }, [], {
    body: selected,
  });
  expect(input.segments?.map((segment) => segment.publication_segment_id)).toEqual([
    "first",
    "tail",
  ]);
  expect(input.segments?.[0]?.settings?.mentions).toEqual({ version: 1, spans: selected.mentions });
  expect(input.segments?.[1]?.body_override).toBeUndefined();
  expect(input.segments?.[1]?.media_inherited).toBe(true);
  const joined = mobileRenditionInput(
    publication,
    "new-account",
    { body: selected.body },
    [],
    { body: selected },
    "join",
  );
  expect(joined.segments).toHaveLength(1);
  expect(joined.segments?.[0]?.source_overrides).toEqual([
    {
      publication_segment_id: "first",
      body_override: "Hi @alice",
      mentions: { version: 1, spans: selected.mentions },
      media_inherited: true,
    },
    {
      publication_segment_id: "tail",
      body_override: undefined,
      mentions: undefined,
      media_inherited: true,
    },
  ]);
});

test("generated text for an added account is the text reviewed and saved", () => {
  const publication = {
    renditions: [],
    segments: [
      {
        id: "first",
        position: 0,
        body: "Original",
        title: "",
        description: "",
        settings: {},
        media: [],
      },
      {
        id: "tail",
        position: 1,
        body: "Continuation",
        title: "",
        description: "",
        settings: {},
        media: [],
      },
    ],
  };
  const generated = mobileRenditionGeneratedText(publication, "new", "Reviewed generated version");
  const visible = mobileRenditionTextFields(publication, "new").map(
    (field) => generated.textEdits[field.key] ?? field.value,
  );
  expect(visible).toEqual(["Reviewed generated version", "Continuation"]);
  const saved = mobileRenditionInput(
    publication,
    "new",
    generated.textEdits,
    [],
    generated.annotated,
  );
  expect(saved.segments?.map((segment) => segment.body_override)).toEqual([
    "Reviewed generated version",
    undefined,
  ]);
});

test("editing inherited joined text keeps selections from every canonical source", () => {
  const acme = {
    start: 3,
    end: 7,
    text: "Acme",
    target: { provider: "linkedin" as const, kind: "page" as const, id: "urn:li:organization:123" },
  };
  const beta = {
    start: 3,
    end: 7,
    text: "Beta",
    target: { provider: "linkedin" as const, kind: "page" as const, id: "urn:li:organization:456" },
  };
  const publication = {
    renditions: [
      {
        ...rendition,
        segments: [
          {
            ...rendition.segments![0],
            publication_segment_id: "first",
            body: "Hi Acme\n\nHi Beta",
            body_override: undefined,
            source_overrides: undefined,
            settings: {},
          },
        ],
      },
    ],
    segments: [
      {
        id: "first",
        position: 0,
        body: "Hi Acme",
        title: "",
        description: "",
        media: [],
        settings: { mentions: { version: 1 as const, spans: [acme] } },
      },
      {
        id: "tail",
        position: 1,
        body: "Hi Beta",
        title: "",
        description: "",
        media: [],
        settings: { mentions: { version: 1 as const, spans: [beta] } },
      },
    ],
  };
  const value = mobileRenditionTextValue(publication, "founder", "segment:0", "Hi Acme\n\nHi Beta");
  expect(value.mentions).toEqual([acme, { ...beta, start: 12, end: 16 }]);
  const saved = mobileRenditionInput(
    publication,
    "founder",
    { "segment:0": value.body + "!" },
    [],
    { "segment:0": { ...value, body: value.body + "!" } },
  );
  expect(saved.segments?.[0]?.settings?.mentions).toEqual({
    version: 1,
    spans: [acme, { ...beta, start: 12, end: 16 }],
  });
});

const rendition: components["schemas"]["RenditionResponse"] = {
  id: "destination",
  publication_id: "post",
  social_account_id: "founder",
  platform: "x",
  target_key: "x",
  profile: "short_text",
  output_profile: "x.video",
  format_locked: true,
  body: "Watch the demo",
  title: "",
  description: "",
  settings: { first_comment: "More detail" },
  schedule_override: "2026-10-12T09:00:00Z",
  status: "draft",
  error_retryable: false,
  media: [],
  segments: [
    {
      id: "variant-1",
      publication_segment_id: "source-1",
      position: 0,
      body: "Watch the demo",
      body_override: "Watch the demo",
      title: "",
      description: "",
      media: [],
      media_inherited: false,
      settings: {
        attachment_requirement: { kind: "video", brief: "Show the real demo" },
        poll: { question: "Try it?" },
      },
      status: "draft",
      error_retryable: false,
      source_overrides: [
        {
          publication_segment_id: "source-1",
          body_override: "First source",
          media_inherited: false,
          media: [],
        },
        { publication_segment_id: "source-2", media_inherited: true },
      ],
    },
  ],
};

test("saving an unchanged generated draft keeps its destination format, requirement, and source decisions", () => {
  const input = mobileRenditionInput(
    { renditions: [rendition], segments: [] },
    "founder",
    undefined,
    [],
  );
  expect(input.output_profile).toBe("x.video");
  expect(input.format_locked).toBe(true);
  expect(input.settings).toEqual({ first_comment: "More detail" });
  expect(input.schedule_override).toBe("2026-10-12T09:00:00Z");
  expect(input.segments?.[0]?.settings).toEqual({
    attachment_requirement: { kind: "video", brief: "Show the real demo" },
    poll: { question: "Try it?" },
  });
  expect(input.segments?.[0]?.media_inherited).toBe(false);
  expect(input.segments?.[0]?.media).toEqual([]);
  expect(input.segments?.[0]?.source_overrides).toEqual([
    {
      publication_segment_id: "source-1",
      body_override: "First source",
      media_inherited: false,
      media: [],
    },
    { publication_segment_id: "source-2", media_inherited: true },
  ]);
});

test("supplying a demo attaches only matching media to the required variant and preserves an explicit empty caption", () => {
  const standalone = {
    ...rendition,
    segments: (rendition.segments ?? []).map((segment) => ({
      ...segment,
      source_overrides: undefined,
    })),
  };
  const input = mobileRenditionInput(
    { renditions: [standalone], segments: [] },
    "founder",
    { "segment:0": "" },
    [
      { mediaId: "screenshot", mimeType: "image/png" },
      { mediaId: "demo", mimeType: "video/mp4" },
    ],
  );
  expect(input.segments?.[0]?.body_override).toBe("");
  expect(input.segments?.[0]?.source_overrides).toBeUndefined();
  expect(input.segments?.[0]?.media).toEqual([{ media_id: "demo" }]);
  expect(input.segments?.[0]?.settings?.attachment_requirement).toEqual({
    kind: "video",
    brief: "Show the real demo",
  });
});

test("supplied attachments carry their per-post alt text into the required variant", () => {
  const standalone = {
    ...rendition,
    segments: (rendition.segments ?? []).map((segment) => ({
      ...segment,
      source_overrides: undefined,
    })),
  };
  const input = mobileRenditionInput(
    { renditions: [standalone], segments: [] },
    "founder",
    { "segment:0": "" },
    [{ mediaId: "demo", mimeType: "video/mp4", altText: "Demo walkthrough" }],
  );
  expect(input.segments?.[0]?.media).toEqual([{ media_id: "demo", alt_text: "Demo walkthrough" }]);
});

test("editing a destination image caption updates the destination's own media row", () => {
  const attached: components["schemas"]["MediaSummary"] = {
    id: "demo",
    mime_type: "video/mp4",
    url: "/media/demo",
    original_filename: "demo.mp4",
    alt_text: "Old caption",
    analysis_status: "ready",
    aspect_ratio: "16:9",
    dominant_type: "video",
    duration_ms: 1000,
    frame_rate: 30,
    height: 1080,
    width: 1920,
    size: 1000,
    public_url_ready: false,
    public_url_status: 0,
  };
  const destination = {
    ...rendition,
    segments: (rendition.segments ?? []).map((segment) => ({
      ...segment,
      source_overrides: undefined,
      media_inherited: false,
      media: [attached],
    })),
  };
  const input = mobileRenditionInput(
    { renditions: [destination], segments: [] },
    "founder",
    undefined,
    [{ mediaId: "demo", mimeType: "video/mp4", altText: "New caption" }],
  );
  expect(input.segments?.[0]?.media?.length).toBe(1);
  expect(input.segments?.[0]?.media?.[0]).toMatchObject({
    media_id: "demo",
    alt_text: "New caption",
  });
});

test("editing one joined source keeps independent images, inherited continuation, and explicit omissions", () => {
  const custom = {
    media_id: "custom-image",
    alt_text: "Original authored caption",
    settings: { crop: "center" },
  };
  const sources = [
    {
      publication_segment_id: "source-1",
      body_override: "Independent first",
      media_inherited: false,
      media: [custom],
    },
    { publication_segment_id: "source-2", media_inherited: true },
    { publication_segment_id: "source-3", body_override: "", media_inherited: false, media: [] },
  ];
  const joined = {
    ...rendition,
    body: "Independent first\n\nInherited continuation",
    segments: (rendition.segments ?? []).map((segment) => ({
      ...segment,
      body: "Independent first\n\nInherited continuation",
      source_overrides: sources,
    })),
  };
  const publication = {
    renditions: [joined],
    segments: ["First canonical", "Inherited continuation", "Omitted canonical"].map(
      (body, index) => ({
        id: `source-${index + 1}`,
        position: index,
        body,
        title: "",
        description: "",
        settings: {},
        media: [],
      }),
    ),
  };
  expect(mobileRenditionTextFields(publication, "founder")).toEqual([
    { key: "source:source-1", value: "Independent first" },
    { key: "source:source-2", value: "Inherited continuation" },
    { key: "source:source-3", value: "" },
  ]);
  const input = mobileRenditionInput(
    publication,
    "founder",
    { "source:source-1": "Revised first" },
    [],
  );
  expect(input.segments?.[0]?.source_overrides).toEqual([
    { ...sources[0], body_override: "Revised first" },
    sources[1],
    sources[2],
  ]);
  expect(input.body).toBe("Revised first\n\nInherited continuation");
});

test("editing a thread continuation preserves the first caption and mirrors its actual text for reopening", () => {
  const thread = {
    ...rendition,
    body: "Stale aggregate caption",
    segments: [
      {
        ...rendition.segments![0]!,
        body: "Independent first",
        body_override: "Independent first",
        source_overrides: undefined,
      },
      {
        ...rendition.segments![0]!,
        id: "variant-2",
        publication_segment_id: "source-2",
        position: 1,
        body: "Second post\n\nGenerated poll: Should we ship?",
        body_override: undefined,
        source_overrides: undefined,
      },
    ],
  };
  const publication = {
    renditions: [thread],
    segments: [
      {
        id: "source-2",
        position: 1,
        body: "Second post",
        title: "",
        description: "",
        settings: {},
        media: [],
      },
    ],
  };
  expect(mobileRenditionTextFields(publication, "founder")).toEqual([
    { key: "segment:0", value: "Independent first" },
    { key: "segment:1", value: "Second post" },
  ]);
  const input = mobileRenditionInput(
    publication,
    "founder",
    { "segment:1": "Edited continuation" },
    [],
  );
  expect(input.body).toBe("Independent first");
  expect(input.segments?.map((segment) => segment.body_override)).toEqual([
    "Independent first",
    "Edited continuation",
  ]);
  expect(input.segments?.[1]?.publication_segment_id).toBe("source-2");
});

test("adding a required demo retains inherited source images inside a joined destination", () => {
  const sourceImage: components["schemas"]["MediaSummary"] = {
    id: "existing-image",
    mime_type: "image/png",
    url: "/media/existing-image",
    original_filename: "proof.png",
    analysis_status: "ready",
    aspect_ratio: "1:1",
    dominant_type: "image",
    duration_ms: 0,
    frame_rate: 0,
    height: 100,
    width: 100,
    size: 100,
    public_url_ready: false,
    public_url_status: 0,
  };
  const joined = {
    ...rendition,
    segments: (rendition.segments ?? []).map((segment) => ({
      ...segment,
      source_overrides: [
        {
          publication_segment_id: "source-1",
          body_override: "Keep this source",
          media_inherited: true,
        },
        { publication_segment_id: "source-2", media_inherited: true },
      ],
    })),
  };
  const input = mobileRenditionInput(
    {
      renditions: [joined],
      segments: [
        {
          id: "source-1",
          position: 0,
          body: "Source",
          title: "",
          description: "",
          settings: {},
          media: [sourceImage],
        },
      ],
    },
    "founder",
    undefined,
    [{ mediaId: "demo", mimeType: "video/mp4" }],
  );
  expect(input.segments?.[0]?.source_overrides?.[0]?.media?.map((item) => item.media_id)).toEqual([
    "existing-image",
    "demo",
  ]);
  expect(input.segments?.[0]?.source_overrides?.[0]?.body_override).toBe("Keep this source");
  expect(input.segments?.[0]?.source_overrides?.[1]?.media_inherited).toBe(true);
});

for (const settings of [null, undefined, {}]) {
  test(`opening a generated segment with ${JSON.stringify(settings)} settings has no attachment requirement`, () => {
    expect(attachmentRequirement(settings)).toBeUndefined();
  });
}

test("legacy destination text edits remap selected identities without stale annotations", () => {
  const target = {
    provider: "bluesky" as const,
    kind: "person" as const,
    id: "did:plc:ewvi7nxzyoun6zhxrhs64oiz",
  };
  const chosen = {
    ...rendition,
    platform: "bluesky",
    segments: [
      {
        ...rendition.segments![0]!,
        source_overrides: undefined,
        body: "Hi @alice",
        body_override: "Hi @alice",
        settings: {
          mentions: { version: 1 as const, spans: [{ start: 3, end: 9, text: "@alice", target }] },
        },
      },
    ],
  };
  const input = mobileRenditionInput(
    { segments: [], renditions: [chosen] },
    "founder",
    { "segment:0": "🚀 Hi @alice" },
    [],
  );
  expect(input.segments?.[0]?.settings?.mentions).toEqual({
    version: 1,
    spans: [{ start: 8, end: 14, text: "@alice", target }],
  });
});
