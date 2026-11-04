import type { components } from '$lib/api/types';

type Publication = components['schemas']['PublicationResponse'];

export function publicationPreviewText(publication: Publication): string {
	return (
		publication.source_text.trim() ||
		publication.segments?.find((segment) => segment.body.trim())?.body.trim() ||
		publication.title.trim()
	);
}

export function publicationPreviewMedia(publication: Publication) {
	const media = [
		...(publication.media ?? []),
		...(publication.segments ?? []).flatMap((segment) => segment.media ?? []),
		...(publication.renditions ?? []).flatMap((rendition) => rendition.media ?? [])
	];
	return media.find((item) => item.mime_type?.startsWith('image/') || item.poster_thumbnail_url);
}
