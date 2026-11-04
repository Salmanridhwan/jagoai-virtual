import { client } from '$lib/api/client';
import { queryClient } from '$lib/query/client';
import { queryGET } from './transport';
import {
	mentionLookupQueryOptions,
	runWithCallerAbort,
	type MentionLookupQueryAPI
} from '@openpost/query-catalog';
const lookupAPI: MentionLookupQueryAPI = {
	async lookupMentions(_workspaceId, accountId, query, signal) {
		const { data } = await queryGET({
			signal,
			fallback: 'Could not search mentions',
			request: (requestSignal) =>
				client.GET('/accounts/{account_id}/mentions', {
					params: { path: { account_id: accountId }, query: { query } },
					signal: requestSignal
				})
		});
		return { ...data, candidates: data.candidates ?? [] };
	}
};
export function lookupComposerMentions(
	workspaceId: string,
	accountId: string,
	query: string,
	signal: AbortSignal
) {
	return runWithCallerAbort(signal, () =>
		queryClient.query(mentionLookupQueryOptions(lookupAPI, workspaceId, accountId, query))
	).then((page) => page.candidates);
}
