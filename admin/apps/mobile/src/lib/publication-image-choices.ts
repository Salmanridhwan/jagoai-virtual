import type { components } from "@openpost/api-contract";
import { postTextForDestination, readMentionMetadata } from "@openpost/platform-text/mentions";
import type { ReadinessSegment } from "./destination-readiness";

type Media = Pick<
  components["schemas"]["MediaSummary"],
  "id" | "role" | "alt_text" | "thumbnail_timestamp_ms" | "settings"
>;
type MediaInput = components["schemas"]["PublicationMediaInput"];
type RenditionInput = components["schemas"]["RenditionInput"];
type SegmentInput = components["schemas"]["RenditionSegmentInput"];
type Publication = Pick<components["schemas"]["PublicationResponse"], "segments" | "renditions"> &
  Partial<Pick<components["schemas"]["PublicationResponse"], "media">>;

function inputs(media: readonly Media[]): MediaInput[] {
  return media.map((item) => ({
    media_id: item.id,
    role: item.role,
    alt_text: item.alt_text,
    thumbnail_timestamp_ms: item.thumbnail_timestamp_ms,
    settings: item.settings,
  }));
}

/** Select fitted copies only in this destination, retaining source and media metadata. */
export function applyRenditionImageChoices(
  publication: Publication,
  rendition: RenditionInput,
  choices: Readonly<Record<string, string>>,
  strategy: "preserve" | "join",
): RenditionInput {
  if (!Object.keys(choices).length) return rendition;
  let changed = false;
  const replace = (media: readonly MediaInput[]) =>
    media.map((item) => {
      const selected = choices[item.media_id];
      if (!selected || selected === item.media_id) return item;
      changed = true;
      return { ...item, media_id: selected };
    });
  const sources = publication.segments ?? [];
  const stored = publication.renditions?.find(
    (item) => item.social_account_id === rendition.social_account_id,
  );
  let segments = rendition.segments;
  if (!segments?.length && !stored?.segments?.length && (stored || !sources.length)) {
    const media = replace(rendition.media ?? inputs(stored?.media ?? publication.media ?? []));
    return changed ? { ...rendition, media } : rendition;
  }
  if (!segments?.length) {
    segments =
      strategy === "join" && sources.length > 1
        ? [
            {
              publication_segment_id: sources[0].id,
              source_overrides: sources.map((source) => ({
                publication_segment_id: source.id,
                media_inherited: true,
              })),
            },
          ]
        : sources.map((source) => ({ publication_segment_id: source.id, media_inherited: true }));
  }
  const output: SegmentInput[] = segments.map((segment, index) => {
    if (segment.source_overrides?.length) {
      const overrides = sources
        .map((source) => {
          const authored = segment.source_overrides?.find(
            (item) => item.publication_segment_id === source.id,
          );
          const media =
            authored?.media_inherited === false
              ? (authored.media ?? [])
              : inputs(source.media ?? []);
          if (!media.some((item) => choices[item.media_id])) return authored;
          return {
            ...authored,
            publication_segment_id: source.id,
            media_inherited: false,
            media: replace(media),
          };
        })
        .filter((value): value is NonNullable<typeof value> => !!value);
      return { ...segment, source_overrides: overrides };
    }
    const storedSegment = stored?.segments?.[index];
    const source = sources.find((source) => source.id === segment.publication_segment_id);
    const media =
      segment.media_inherited === false
        ? (segment.media ?? [])
        : inputs(storedSegment?.media ?? source?.media ?? []);
    if (!media.some((item) => choices[item.media_id])) return segment;
    return { ...segment, media_inherited: false, media: replace(media) };
  });
  return changed ? { ...rendition, segments: output } : rendition;
}

/** Project the same destination choices used by Save into capability checks. */
export function renditionReadinessSegments(
  publication: Publication,
  rendition: RenditionInput,
  canonical: ReadinessSegment[],
  strategy: "preserve" | "join",
  destination?: { platform: string; instance_url?: string },
): { content: string; mediaIds: string[] }[] {
  const sources = publication.segments ?? [];
  const stored = publication.renditions?.find(
    (item) => item.social_account_id === rendition.social_account_id,
  );
  const platform = destination?.platform ?? stored?.platform ?? "";
  const project = (body: string, mentions: unknown) =>
    postTextForDestination(
      { body, mentions: readMentionMetadata(body, mentions)?.spans },
      platform,
      destination?.instance_url,
    ).body;
  canonical = canonical.map((segment) => ({
    ...segment,
    content: postTextForDestination(
      { body: segment.content, mentions: segment.mentions },
      platform,
      destination?.instance_url,
    ).body,
  }));
  const sourceValue = (id: string | undefined, index: number) =>
    canonical[sources.findIndex((source) => source.id === id)] ??
    canonical[index] ?? { content: "", mediaIds: [] };
  const join = (values: { content: string; mediaIds: string[] }[]) => ({
    content: values
      .map((value) => value.content.trim())
      .filter(Boolean)
      .join("\n\n"),
    mediaIds: [...new Set(values.flatMap((value) => value.mediaIds))],
  });
  if (!rendition.segments?.length) {
    if (stored && !stored.segments?.length)
      return [
        {
          content: rendition.body ?? stored.body,
          mediaIds:
            rendition.media?.map((item) => item.media_id) ??
            stored.media?.map((item) => item.id) ??
            [],
        },
      ];
    return strategy === "join" && canonical.length > 1 ? [join(canonical)] : canonical;
  }
  return rendition.segments.map((segment, index) => {
    if (segment.source_overrides?.length)
      return join(
        sources.map((source, position) => {
          const inherited = canonical[position] ?? { content: "", mediaIds: [] };
          const override = segment.source_overrides?.find(
            (item) => item.publication_segment_id === source.id,
          );
          return {
            content:
              override?.body_override == null
                ? inherited.content
                : project(override.body_override, override.mentions),
            mediaIds:
              override?.media_inherited === false
                ? (override.media ?? []).map((item) => item.media_id)
                : inherited.mediaIds,
          };
        }),
      );
    const inherited =
      rendition.segments?.length === 1 && canonical.length > 1
        ? join(canonical)
        : sourceValue(segment.publication_segment_id, index);
    return {
      content:
        segment.body_override != null || segment.body != null
          ? project(segment.body_override ?? segment.body ?? "", segment.settings?.mentions)
          : inherited.content,
      mediaIds:
        segment.media_inherited === false
          ? (segment.media ?? []).map((item) => item.media_id)
          : inherited.mediaIds,
    };
  });
}
