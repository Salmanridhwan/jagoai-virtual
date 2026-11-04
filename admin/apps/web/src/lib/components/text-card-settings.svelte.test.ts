import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { SocialAccount } from '$lib/api/client';
import TextCardSettings from './text-card-settings.svelte';

const transport = vi.hoisted(() => {
	const send = vi.fn<typeof fetch>();
	vi.stubGlobal('fetch', send);
	return send;
});
const account: SocialAccount = {
	id: 'instagram-main',
	slug: 'instagram-main',
	platform: 'instagram',
	account_id: 'ig-1',
	account_username: 'founder',
	account_avatar_url: '',
	instance_url: '',
	is_active: true,
	grant_destination_count: 1,
	shared_grant: false,
	messaging_supported: true,
	messages_enabled: false,
	thread_replies_supported: true
};
afterEach(() => vi.resetAllMocks());

it('shows catalogue default colors instead of a hardcoded hex', async () => {
	transport.mockResolvedValue(
		Response.json({
			images: [
				{
					data_url:
						'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"/>',
					width: 1080,
					height: 1350
				}
			]
		})
	);
	const screen = render(TextCardSettings, {
		account,
		values: { text_card: 'always' },
		defaults: { text_card_color: '#1a2b3c', text_card_color_end: '#4d5e6f' },
		outputProfile: 'instagram.feed',
		text: 'Launch day',
		attachmentCount: 0,
		onChange: () => {}
	});
	await screen.getByText('Customize card').click();
	await expect.element(screen.getByText('#1a2b3c')).toBeVisible();
	await expect.element(screen.getByText('#4d5e6f')).toBeVisible();
});

it('prefers authored values over catalogue defaults', async () => {
	transport.mockResolvedValue(Response.json({ images: [] }));
	const screen = render(TextCardSettings, {
		account,
		values: { text_card: 'always', text_card_color: '#7f8ea3' },
		defaults: { text_card_color: '#1a2b3c', text_card_color_end: '#4d5e6f' },
		outputProfile: 'instagram.feed',
		text: 'Launch day',
		attachmentCount: 0,
		onChange: () => {}
	});
	await screen.getByText('Customize card').click();
	await expect.element(screen.getByText('#7f8ea3')).toBeVisible();
	await expect.element(screen.getByText('#4d5e6f')).toBeVisible();
});
