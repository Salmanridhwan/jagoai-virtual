import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import TextCardPreview from './text-card-preview.svelte';
import { textCardRequestKey, type TextCardRequest } from '$lib/text-cards';

const transport = vi.hoisted(() => {
	const send = vi.fn<typeof fetch>();
	vi.stubGlobal('fetch', send);
	return send;
});
const request: TextCardRequest = {
	social_account_id: 'account',
	text: 'Saved text',
	settings: { text_card: 'text_only' }
};
const image = {
	data_url:
		'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"/>',
	width: 1080,
	height: 1350
};
afterEach(() => vi.resetAllMocks());

it('shows the stored publishing image without re-rendering until the text changes', async () => {
	const savedPreview = {
		key: textCardRequestKey(request),
		images: [image],
		loading: false,
		error: ''
	};
	const screen = render(TextCardPreview, { request, savedPreview });
	await expect.element(screen.getByRole('img')).toHaveAttribute('src', image.data_url);
	expect(transport).not.toHaveBeenCalled();
	transport.mockResolvedValue(
		Response.json({ images: [{ ...image, data_url: image.data_url + '#changed' }] })
	);
	await screen.rerender({ request: { ...request, text: 'Changed text' }, savedPreview });
	await expect.element(screen.getByRole('img')).toHaveAttribute('src', image.data_url + '#changed');
	expect(transport).toHaveBeenCalledTimes(1);
});

it('discards late results from older text and lets a failed preview retry', async () => {
	let finishOld!: (value: Response) => void;
	transport.mockImplementationOnce(
		() =>
			new Promise<Response>((resolve) => {
				finishOld = resolve;
			})
	);
	const screen = render(TextCardPreview, { request });
	await expect.poll(() => transport.mock.calls.length).toBe(1);
	transport.mockResolvedValueOnce(
		Response.json({ detail: 'Preview unavailable' }, { status: 503 })
	);
	await screen.rerender({ request: { ...request, text: 'New text' } });
	await expect.element(screen.getByRole('alert')).toHaveTextContent('Preview unavailable');
	finishOld(Response.json({ images: [image] }));
	transport.mockResolvedValueOnce(
		Response.json({ images: [{ ...image, data_url: image.data_url + '#new' }] })
	);
	await screen.getByRole('button', { name: 'Try again' }).click();
	await expect.element(screen.getByRole('img')).toHaveAttribute('src', image.data_url + '#new');
});
