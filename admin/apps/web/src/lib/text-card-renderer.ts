import { client } from '$lib/api/client';
import { m } from '$lib/paraglide/messages';
import type { TextCardImage, TextCardRequest } from '$lib/text-cards';

// Rendering returns ephemeral image bytes for unsaved edits. Keep it in an
// imperative adapter, like editor exports, rather than caching authored state.
export async function renderTextCardPreview(
	request: TextCardRequest,
	signal: AbortSignal
): Promise<TextCardImage[]> {
	const { data, error } = await client.POST('/publications/preview-text-card', {
		body: request,
		signal
	});
	if (error || !data?.images?.length)
		throw new Error(error?.detail || m.text_card_preview_failed());
	return data.images;
}
