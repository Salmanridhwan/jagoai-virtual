export type MediaThumbKind = 'image' | 'video' | 'audio' | 'other';

export interface MediaThumbSource {
	thumbnail_url?: string | null;
	poster_thumbnail_url?: string | null;
	url: string;
}

export interface MediaThumbLabeled {
	alt_text?: string | null;
	original_filename?: string | null;
}

export type MediaThumbItem = MediaThumbSource &
	MediaThumbLabeled & {
		mime_type: string;
	};

export function mediaThumbKind(mimeType: string): MediaThumbKind {
	if (mimeType.startsWith('image/')) return 'image';
	if (mimeType.startsWith('video/')) return 'video';
	if (mimeType.startsWith('audio/')) return 'audio';
	return 'other';
}

export function mediaThumbnailURL(item: MediaThumbSource): string {
	return item.thumbnail_url || item.poster_thumbnail_url || item.url || '';
}

export function mediaThumbAlt(item: MediaThumbLabeled, fallback: string): string {
	return item.alt_text || item.original_filename || fallback;
}
