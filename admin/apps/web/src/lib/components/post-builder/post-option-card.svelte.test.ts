import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { SocialAccount } from '$lib/api/client';
import type { PublicationPostOption } from '$lib/post-builder/client';
import PostOptionCard from './post-option-card.svelte';
import '../../../routes/layout.css';

interface HTTPInterception {
	handle?: typeof fetch;
}

const http = vi.hoisted(() => {
	const original = globalThis.fetch.bind(globalThis);
	const state: HTTPInterception = {};
	globalThis.fetch = (input, init) => state.handle?.(input, init) ?? original(input, init);
	return { original, state };
});

const account: SocialAccount = {
	id: 'x-main',
	slug: 'x-main',
	platform: 'x',
	account_id: '123',
	account_username: 'founder',
	account_avatar_url: '',
	instance_url: '',
	is_active: true,
	grant_destination_count: 1,
	shared_grant: false,
	messaging_supported: false,
	messages_enabled: false,
	thread_replies_supported: true
};
const option: PublicationPostOption = {
	id: 'option-1',
	label: 'The preference',
	canonical_text: '',
	direction: {
		thesis: 'Fewer lines, more features.',
		outcome: 'shares',
		audience: 'engineers',
		angle: 'prefer simplicity',
		route: 'artifact_led',
		media: { treatment: 'meme', role: 'punchline', brief: 'Prefer fewer lines.' }
	},
	destinations: [
		{
			account_id: account.id,
			platform: 'x',
			objective: 'shares',
			archetype: 'artifact_joke',
			output_profile: 'x.short_text',
			preview: '',
			segments: [{ body: '' }],
			media: {
				treatment: 'meme',
				role: 'punchline',
				brief: 'Prefer fewer lines.',
				document: {
					schema_version: 1,
					template_id: 'meme',
					title: 'Less code',
					appearance: 'light',
					frame: 'natural',
					text_size: 'normal',
					meme: {
						template_id: 'drake',
						name: 'Drake',
						captions: ['more code', 'more features'],
						format: 'png',
						overlay_slots: 0,
						overlay_media_ids: []
					}
				}
			}
		}
	]
};
afterEach(() => {
	http.state.handle = undefined;
	vi.restoreAllMocks();
});
afterAll(() => {
	globalThis.fetch = http.original;
});
it('retains a rendered visual while caption edits update the native preview', async () => {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = 2;
	const png = canvas.toDataURL('image/png');
	const previews: unknown[] = [];
	http.state.handle = async (input, init) => {
		const request = input instanceof Request ? input : new Request(input, init);
		if (new URL(request.url).pathname !== '/api/v1/memes/preview')
			return http.original(input, init);
		previews.push(await request.json());
		return Response.json({ mime_type: 'image/png', data_base64: png.split(',')[1] });
	};
	const use = vi.fn();
	const props = {
		option,
		account,
		workspaceId: 'workspace-1',
		onUse: use,
		onChange: vi.fn()
	};
	const screen = render(PostOptionCard, props);
	await expect.element(screen.getByRole('button', { name: 'Use this post' })).toBeEnabled();
	expect(previews).toEqual([
		{
			workspace_id: 'workspace-1',
			template_id: 'drake',
			captions: ['more code', 'more features'],
			overlay_media_ids: [],
			format: 'png'
		}
	]);
	expect(screen.container.querySelector('img[src^="data:image/png"]')?.getAttribute('src')).toBe(
		png
	);
	const edited = structuredClone(option);
	edited.destinations[0].segments[0].body = 'apparently the delete key is a product feature';
	await screen.rerender({ ...props, option: edited });
	await expect.element(screen.getByText(edited.destinations[0].segments[0].body)).toBeVisible();
	expect(previews).toHaveLength(1);
	expect(screen.container.querySelector('img[src^="data:image/png"]')?.getAttribute('src')).toBe(
		png
	);
	await screen.getByRole('button', { name: 'Use this post' }).click();
	expect(use).toHaveBeenCalledWith(edited);
	await screen.unmount();
});

it('discards late visual renders after recipe and Workspace changes or unmount', async () => {
	const completions: Array<() => void> = [];
	const renderStarts = Array.from({ length: 3 }, () => Promise.withResolvers<void>());
	const decode = globalThis.createImageBitmap.bind(globalThis);
	vi.spyOn(globalThis, 'createImageBitmap').mockImplementation(async (image) => {
		const bitmap = await decode(image);
		const pending = Promise.withResolvers<ImageBitmap>();
		completions.push(() => pending.resolve(bitmap));
		renderStarts[completions.length - 1].resolve();
		return pending.promise;
	});
	const revoked = vi.spyOn(URL, 'revokeObjectURL');
	const screenshot = structuredClone(option);
	screenshot.destinations[0].media = {
		treatment: 'template',
		role: 'punchline',
		brief: 'A codebase conversation.',
		template_id: 'messages',
		document: {
			schema_version: 1,
			template_id: 'messages',
			title: 'A codebase conversation',
			appearance: 'light',
			frame: 'natural',
			text_size: 'normal',
			conversation: {
				name: 'The codebase',
				timestamp: '',
				show_header: false,
				read_receipt: '',
				self_id: 'me',
				people: [
					{ id: 'me', name: 'Me' },
					{ id: 'code', name: 'Codebase' }
				],
				messages: [
					{ id: 'one', sender_id: 'me', text: 'I deleted 15,000 lines.' },
					{ id: 'two', sender_id: 'code', text: 'More features. Thanks.' }
				]
			}
		}
	};
	const props = {
		option: screenshot,
		account,
		workspaceId: 'workspace-1',
		onUse: vi.fn(),
		onChange: vi.fn()
	};
	const screen = render(PostOptionCard, props);
	await renderStarts[0].promise;
	await screen.rerender({ ...props, workspaceId: 'workspace-2' });
	await renderStarts[1].promise;
	const next = structuredClone(screenshot);
	next.destinations[0].media.document!.title = 'A new recipe';
	await screen.rerender({ ...props, option: next, workspaceId: 'workspace-2' });
	await renderStarts[2].promise;
	completions[0]();
	await expect.poll(() => revoked.mock.calls.length).toBe(1);
	expect(revoked.mock.calls[0][0]).toMatch(/^blob:/);
	expect(screen.container.querySelector('img[src^="blob:"]')).toBeNull();
	completions[1]();
	await expect.poll(() => revoked.mock.calls.length).toBe(2);
	expect(screen.container.querySelector('img[src^="blob:"]')).toBeNull();
	await expect.element(screen.getByText('Rendering the visual…')).toBeVisible();
	await expect.element(screen.getByRole('button', { name: 'Use this post' })).toBeDisabled();
	await screen.unmount();
	completions[2]();
	await expect.poll(() => revoked.mock.calls.length).toBe(3);
	for (const [url] of revoked.mock.calls) expect(url).toMatch(/^blob:/);
	expect(new Set(revoked.mock.calls.map(([url]) => url)).size).toBe(3);
});
