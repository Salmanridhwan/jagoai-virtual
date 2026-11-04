import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { client } from '$lib/api/client';
import { auth } from '$lib/stores/auth';
import { userProfileDefaults } from '$lib/test-fixtures/user-profile';
import InboxUpdates from './inbox-updates.svelte';

const get = vi.spyOn(client, 'GET');
const post = vi.spyOn(client, 'POST');
afterEach(() => {
	vi.restoreAllMocks();
});

it('retires pending updates on view, visibility, connectivity and actor changes', async () => {
	auth.setUser({
		...userProfileDefaults,
		id: 'reader',
		email: 'reader@example.test',
		username: 'reader',
		public_profile_enabled: false,
		is_admin: false,
		is_managed: false,
		has_password: true,
		legal_acceptance_required: false,
		email_verified: true,
		created_at: '2026-10-20T10:00:00Z'
	});
	const signals: AbortSignal[] = [];
	get.mockImplementation(async (path, options?: { signal?: AbortSignal | null }) => {
		if (path !== '/inbox/changes') throw new Error('Unexpected read');
		const signal = options?.signal;
		if (!signal) throw new Error('Missing cancellation signal');
		signals.push(signal);
		return new Promise((_resolve, reject) =>
			signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
				once: true
			})
		);
	});
	post.mockResolvedValue({ response: new Response(null, { status: 204 }) });
	const screen = await render(InboxUpdates, { workspaceId: 'workspace', view: 'chats' });
	await vi.waitFor(() => expect(signals).toHaveLength(1));
	expect(post).toHaveBeenCalledWith(
		'/inbox/activity',
		expect.objectContaining({
			body: expect.objectContaining({ workspace_id: 'workspace', view: 'chats' })
		})
	);
	await screen.rerender({ workspaceId: 'workspace', view: 'conversation', conversationId: 'chat' });
	await vi.waitFor(() => expect(signals).toHaveLength(2));
	expect(signals[0].aborted).toBe(true);
	const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
	document.dispatchEvent(new Event('visibilitychange'));
	await vi.waitFor(() => expect(signals[1].aborted).toBe(true));
	visibility.mockReturnValue('visible');
	document.dispatchEvent(new Event('visibilitychange'));
	await vi.waitFor(() => expect(signals).toHaveLength(3));
	const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
	window.dispatchEvent(new Event('offline'));
	await vi.waitFor(() => expect(signals[2].aborted).toBe(true));
	online.mockReturnValue(true);
	window.dispatchEvent(new Event('online'));
	await vi.waitFor(() => expect(signals).toHaveLength(4));
	auth.setUser(null);
	await vi.waitFor(() => expect(signals[3].aborted).toBe(true));
});
