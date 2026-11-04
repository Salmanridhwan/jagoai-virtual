import type { PublicationReviewQueryAPI } from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import { queryGET } from './transport';

export const publicationReviewQueryAPI: PublicationReviewQueryAPI = {
	async list(_workspaceId, publicationId, signal) {
		const { data } = await queryGET({
			signal,
			fallback: 'Unable to load post reviews',
			request: (requestSignal) =>
				client.GET('/publications/{id}/reviews', {
					params: { path: { id: publicationId } },
					signal: requestSignal
				})
		});
		return data ?? [];
	}
};
