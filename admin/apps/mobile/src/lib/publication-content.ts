import {
  readMentionMetadata,
  remapMentionMetadata,
  type PostTextValue,
} from "@openpost/platform-text/mentions";
import type { components } from "@openpost/api-contract";
import type { ReadinessSegment } from "./destination-readiness";

type Media = Pick<components["schemas"]["MediaSummary"], "id"> &
  Partial<
    Pick<
      components["schemas"]["MediaSummary"],
      "role" | "alt_text" | "thumbnail_timestamp_ms" | "settings"
    >
  >;
type Segment = Omit<components["schemas"]["PublicationSegmentResponse"], "media" | "position"> & {
  media?: readonly Media[] | null;
};
type PublicationContent = {
  source_text: string;
  title?: string;
  source_url?: string;
  segments?: readonly Segment[] | null;
  media?: readonly Media[] | null;
};

export function publicationReadinessSegments(
  publication: PublicationContent,
  body: string,
  firstSegmentMediaIds: string[],
  textEdits?: Readonly<Record<string, PostTextValue>>,
): ReadinessSegment[] {
  const update = publicationContentUpdate(
    publication,
    body,
    firstSegmentMediaIds,
    undefined,
    textEdits,
  );
  if (update.segments) {
    return update.segments.map((segment) => ({
      content: segment.body ?? "",
      mediaIds: (segment.media ?? []).map((media) => media.media_id),
      ...(readMentionMetadata(segment.body ?? "", segment.settings?.mentions)
        ? { mentions: readMentionMetadata(segment.body ?? "", segment.settings?.mentions)!.spans }
        : {}),
    }));
  }
  const canonical = publication.segments?.length
    ? publication.segments
    : [{ body: publication.source_text, media: publication.media }];
  return canonical.map((segment, index) => ({
    content: index === 0 ? body : segment.body,
    ...("settings" in segment && readMentionMetadata(segment.body, segment.settings?.mentions)
      ? { mentions: readMentionMetadata(segment.body, segment.settings?.mentions)!.spans }
      : {}),
    mediaIds: index === 0 ? firstSegmentMediaIds : (segment.media ?? []).map((media) => media.id),
  }));
}

function mediaInput(
  media: Media,
  altTexts?: ReadonlyMap<string, string>,
): components["schemas"]["PublicationMediaInput"] {
  const input: components["schemas"]["PublicationMediaInput"] = {
    media_id: media.id,
    ...(media.role === undefined ? {} : { role: media.role }),
    ...(media.alt_text === undefined ? {} : { alt_text: media.alt_text }),
    ...(media.thumbnail_timestamp_ms === undefined
      ? {}
      : { thumbnail_timestamp_ms: media.thumbnail_timestamp_ms }),
    ...(media.settings === undefined ? {} : { settings: media.settings }),
  };
  const override = altTexts?.get(media.id);
  if (override !== undefined) input.alt_text = override;
  return input;
}

export function publicationContentUpdate(
  publication: PublicationContent,
  body: string,
  mediaIds: readonly string[],
  altTexts?: ReadonlyMap<string, string>,
  textEdits?: Readonly<Record<string, PostTextValue>>,
): Pick<components["schemas"]["PublicationUpdateBody"], "source_text" | "segments"> {
  const segments = publication.segments?.length
    ? publication.segments
    : [
        {
          body: publication.source_text,
          title: publication.title ?? "",
          description: "",
          url: publication.source_url,
          settings: {},
          media: publication.media,
        },
      ];
  const first = segments[0];
  const initialMedia = first.media ?? [];
  const mediaChanged =
    mediaIds.length !== initialMedia.length ||
    mediaIds.some((id, index) => id !== initialMedia[index]?.id);
  const altChanged = altTexts
    ? [...altTexts].some(([id, alt]) => {
        const existing = initialMedia.find((media) => media.id === id);
        return existing ? (existing.alt_text ?? "") !== alt : alt !== "";
      })
    : false;
  if (body === first.body && !mediaChanged && !altChanged && !Object.keys(textEdits ?? {}).length)
    return { source_text: body };

  return {
    source_text: body,
    segments: segments.map((segment, index) => ({
      ...("id" in segment ? { id: segment.id } : {}),
      body:
        textEdits?.[("id" in segment ? segment.id : undefined) ?? "first"]?.body ??
        (index === 0 ? body : segment.body),
      title: segment.title,
      description: segment.description,
      ...(segment.url === undefined ? {} : { url: segment.url }),
      settings: authoredTextSettings(
        segment.body,
        textEdits?.[("id" in segment ? segment.id : undefined) ?? "first"]?.body ??
          (index === 0 ? body : segment.body),
        segment.settings,
        textEdits?.[("id" in segment ? segment.id : undefined) ?? "first"],
      ),
      media:
        index === 0
          ? mediaIds.map((id) => {
              const existing = initialMedia.find((media) => media.id === id);
              if (existing) return mediaInput(existing, altTexts);
              const override = altTexts?.get(id);
              return override === undefined
                ? { media_id: id }
                : { media_id: id, alt_text: override };
            })
          : (segment.media ?? []).map((media) => mediaInput(media, altTexts)),
    })),
  };
}

function authoredTextSettings(
  before: string,
  after: string,
  settings: components["schemas"]["PublicationSegmentInput"]["settings"],
  edited?: PostTextValue,
) {
  const result = { ...settings };
  if (edited?.mentions !== undefined) result.mentions = { version: 1, spans: edited.mentions };
  else {
    const mentions = remapMentionMetadata(
      before,
      after,
      readMentionMetadata(before, settings?.mentions),
    );
    if (mentions) result.mentions = mentions;
  }
  return result;
}
