import type { components } from "@openpost/api-contract";

type Rendition = components["schemas"]["RenditionResponse"];

/** Generated cards supplement the authored attachments in native post details. */
export function textCardImages(rendition: Rendition) {
  const media = rendition.segments?.flatMap((segment) => segment.output_media ?? []) ?? [];
  const seen = new Set<string>();
  return media.filter((item) => {
    if (item.role !== "text_card" || !item.mime_type.startsWith("image/") || seen.has(item.id))
      return false;
    seen.add(item.id);
    return true;
  });
}
