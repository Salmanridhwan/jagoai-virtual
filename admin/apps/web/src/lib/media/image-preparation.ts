import type { components } from '$lib/api/types';
import { client } from '$lib/api/client';
import type { MediaUploadResult } from '$lib/media-upload-client';
import { m } from '$lib/paraglide/messages';

export async function optimizeStoredImage(
	mediaId: string,
	signal?: AbortSignal
): Promise<MediaUploadResult | null> {
	const { data, error } = await client.POST('/media/{id}/optimize-image', {
		params: { path: { id: mediaId } },
		signal
	});
	if (error || !data) throw new Error(error?.detail || m.compose_image_fit_failed());
	return data.optimized ? data.media : null;
}

export async function fitStoredImage(options: {
	mediaId: string;
	accountId: string;
	outputProfile: string;
	settings: NonNullable<components['schemas']['PrepareMediaImageBody']['settings']>;
	altText: string;
	signal: AbortSignal;
}): Promise<MediaUploadResult> {
	const { data, error } = await client.POST('/media/{id}/prepare-image', {
		params: { path: { id: options.mediaId } },
		body: {
			account_id: options.accountId,
			output_profile: options.outputProfile,
			settings: options.settings,
			alt_text: options.altText
		},
		signal: options.signal
	});
	if (error || !data) throw new Error(error?.detail || m.compose_image_fit_failed());
	return data.media;
}
