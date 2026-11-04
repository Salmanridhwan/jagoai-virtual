import type { paths, components } from '@openpost/api-contract';
import {
	videoProjectListQueryOptions,
	videoProjectSummariesQueryOptions,
	videoProjectQueryKeys
} from '@openpost/query-catalog';
import { QueryClient } from '@tanstack/svelte-query';
import createClient from 'openapi-fetch';
import { expect, it } from 'vitest';
import { createVideoProjectQueryAPI } from './video-projects';

it('keeps summary and full lists separate and refreshes both after a project mutation', async () => {
	const requests: URL[] = [];
	let name = 'Before rename';
	const fetcher: typeof fetch = async (input, init) => {
		const request = input instanceof Request ? input : new Request(input, init);
		const url = new URL(request.url);
		requests.push(url);
		const metadata = {
			id: 'project',
			workspace_id: 'workspace',
			name,
			head_revision: 1,
			sync_status: 'synced',
			created_by_user_id: 'user',
			updated_by_user_id: 'user',
			created_at: '2026-10-13T20:00:00Z',
			updated_at: '2026-10-13T20:00:00Z'
		};
		return Response.json([
			url.pathname.endsWith('/video-project-summaries')
				? { ...metadata, schema_family: 'openpost' }
				: { ...metadata, document: { timeline: { items: [{ id: 'clip' }] } } }
		]);
	};
	const api = createVideoProjectQueryAPI(
		createClient<paths>({ baseUrl: 'https://openpost.test/api/v1', fetch: fetcher })
	);
	const cache = new QueryClient();
	try {
		const fullOptions = videoProjectListQueryOptions(api, 'workspace', true);
		const summaryOptions = videoProjectSummariesQueryOptions(api, 'workspace', true);
		const full = await cache.fetchQuery(fullOptions);
		const summaries = await cache.fetchQuery(summaryOptions);
		expect(full[0]?.document).toEqual({ timeline: { items: [{ id: 'clip' }] } });
		expect(summaries[0]).toMatchObject({ name: 'Before rename', schema_family: 'openpost' });
		expect(summaries[0]).not.toHaveProperty('document');
		expect(requests.map((url) => url.pathname)).toEqual([
			'/api/v1/video-projects',
			'/api/v1/video-project-summaries'
		]);
		expect(Object.fromEntries(requests[1]!.searchParams)).toEqual({
			workspace_id: 'workspace',
			include_trash: 'true'
		});
		// Existing mutation invalidation covers both list representations.
		name = 'After rename';
		await cache.invalidateQueries({ queryKey: videoProjectQueryKeys.lists('workspace') });
		expect((await cache.fetchQuery(summaryOptions))[0]?.name).toBe('After rename');
		expect((await cache.fetchQuery(fullOptions))[0]?.name).toBe('After rename');
		expect(
			cache.getQueryData<components['schemas']['VideoProjectResponse'][]>(fullOptions.queryKey)?.[0]
				?.document
		).toHaveProperty('timeline');
	} finally {
		cache.clear();
	}
});
