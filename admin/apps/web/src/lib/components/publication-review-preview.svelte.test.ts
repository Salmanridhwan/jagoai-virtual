import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
import type { components } from '$lib/api/types';
import { client } from '$lib/api/client';
import PublicationReviewPreview from './publication-review-preview.svelte';
import '../../routes/layout.css';

afterEach(() => vi.restoreAllMocks());

it('shows the submitted segment metadata and first comment when they override destination defaults', async () => {
	vi.spyOn(client, 'GET').mockResolvedValue({
		data: { capabilities: [] },
		response: new Response()
	});
	const publication: components['schemas']['PublicationResponse'] = {
		id: 'post',
		workspace_id: 'workspace',
		title: 'Internal campaign title',
		source_text: '',
		content_profile: '',
		created_at: '',
		created_by: '',
		creation_preset: 'post',
		creation_source: 'web',
		intent: '',
		media: [],
		metadata: {},
		random_delay_inherited: false,
		random_delay_minutes: 0,
		repost_override: { mode: 'inherit' },
		revision: 1,
		segments: [],
		status: 'draft',
		updated_at: '',
		renditions: [
			{
				id: 'variant',
				publication_id: 'post',
				social_account_id: 'account',
				platform: 'youtube',
				body: 'Published body',
				title: 'Destination default title',
				description: 'Destination default description',
				error_retryable: false,
				format_locked: false,
				media: [],
				output_profile: 'video',
				profile: 'video',
				settings: { first_comment: 'Destination default comment' },
				status: 'draft',
				target_key: 'youtube',
				segments: [
					{
						id: 'segment',
						publication_segment_id: 'source',
						body: 'Published body',
						title: 'Submitted video title',
						description: 'Submitted video description',
						position: 0,
						error_retryable: false,
						media: [],
						media_inherited: true,
						settings: { first_comment: 'Submitted first comment' },
						status: 'draft'
					}
				]
			}
		]
	};
	const screen = await render(
		PublicationReviewPreview,
		{ publication, accounts: [] },
		{
			wrapper: QueryClientProvider,
			wrapperProps: { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }
		}
	);
	await expect.element(screen.getByText('Submitted video title', { exact: true })).toBeVisible();
	await expect
		.element(screen.getByText('Submitted video description', { exact: true }))
		.toBeVisible();
	await expect.element(screen.getByText('Submitted first comment', { exact: true })).toBeVisible();
	await expect
		.element(screen.getByText('Destination default comment', { exact: true }))
		.not.toBeInTheDocument();
});
