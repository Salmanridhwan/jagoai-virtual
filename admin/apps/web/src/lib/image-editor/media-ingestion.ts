import { getAuthenticatedMediaByID } from '$lib/media-url';
import { ImageEditorAnimationError } from './animation-error';
import { readImageEditorGif } from './gif-client';
import type { ImageEditorAnimation } from './types';

/** Inspect original library bytes before creating an editable GIF layer. */
export async function inspectImageEditorMediaAnimation(
	media: { id: string; name?: string; mime_type?: string },
	signal?: AbortSignal
): Promise<ImageEditorAnimation | undefined> {
	if (media.mime_type !== 'image/gif' && !/\.gif$/i.test(media.name ?? '')) return;
	const response = await fetch(getAuthenticatedMediaByID(media.id), {
		credentials: 'include',
		signal
	});
	if (!response.ok) throw new ImageEditorAnimationError('missing_media');
	return (await readImageEditorGif(await response.blob(), false, signal)).animation;
}
