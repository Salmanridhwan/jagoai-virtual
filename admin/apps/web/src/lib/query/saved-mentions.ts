import { client } from '$lib/api/client';
import { queryClient } from './client';
import { queryGET } from './transport';
import {
	captureQueryMutationSession,
	queryMutationSessionIsCurrent,
	isSessionUnauthorized,
	settleQueryUnauthorized
} from './authorization-boundary';
import {
	savedMentionsQueryOptions,
	savedMentionQueryKey,
	runWithCallerAbort,
	type SavedMention,
	type SavedMentionQueryAPI
} from '@openpost/query-catalog';
import type { MentionCandidate, MentionProfile } from '@openpost/platform-text/mentions';
import { m } from '$lib/paraglide/messages';

const api: SavedMentionQueryAPI = {
	async listSavedMentions(workspaceId, signal) {
		const { data } = await queryGET({
			signal,
			fallback: m.saved_mentions_load_failed(),
			request: async (requestSignal) => {
				const result = await client.GET('/workspaces/{workspace_id}/mentions', {
					params: { path: { workspace_id: workspaceId } },
					signal: requestSignal
				});
				return { ...result, data: result.error ? undefined : (result.data ?? []) };
			}
		});
		return data.map((entry) => ({ ...entry, profiles: entry.profiles ?? [] }));
	}
};

export function querySavedMentions(workspaceId: string, signal: AbortSignal) {
	return runWithCallerAbort(signal, () =>
		queryClient.query(savedMentionsQueryOptions(api, workspaceId))
	);
}
export function savedMentionCandidate(entry: SavedMention): MentionCandidate {
	return {
		label: entry.name,
		detail: entry.profiles.map((profile) => profile.text).join(' · '),
		target: { provider: 'workspace', kind: 'profile', id: entry.id, profiles: entry.profiles }
	};
}
export async function searchSavedMentions(workspaceId: string, query: string, signal: AbortSignal) {
	const entries = await querySavedMentions(workspaceId, signal);
	const needle = query.toLocaleLowerCase().replace(/^@/, '');
	return entries
		.filter((entry) =>
			[entry.name, ...entry.profiles.map((profile) => profile.text)].some((text) =>
				text.toLocaleLowerCase().includes(needle)
			)
		)
		.map(savedMentionCandidate);
}
export async function saveSavedMention(
	workspaceId: string,
	name: string,
	profiles: MentionProfile[],
	id?: string
): Promise<SavedMention> {
	const session = captureQueryMutationSession();
	const { data, error, response } = await client.POST('/workspaces/{workspace_id}/mentions', {
		params: { path: { workspace_id: workspaceId } },
		body: { id, name, profiles }
	});
	if (isSessionUnauthorized(response)) settleQueryUnauthorized(session.authorizationIdentity);
	if (!queryMutationSessionIsCurrent(session)) throw new Error(m.saved_mentions_save_failed());
	if (error || !data) throw new Error(error?.detail ?? m.saved_mentions_save_failed());
	await queryClient.cancelQueries({ queryKey: savedMentionQueryKey(workspaceId), exact: true });
	if (!queryMutationSessionIsCurrent(session)) throw new Error(m.saved_mentions_save_failed());
	const saved = { ...data, profiles: data.profiles ?? [] };
	queryClient.setQueryData<SavedMention[]>(savedMentionQueryKey(workspaceId), (entries) =>
		[...(entries ?? []).filter((entry) => entry.id !== saved.id), saved].sort((a, b) =>
			a.name.localeCompare(b.name)
		)
	);
	return saved;
}
export async function deleteSavedMention(workspaceId: string, id: string) {
	const session = captureQueryMutationSession();
	const { error, response } = await client.DELETE('/workspaces/{workspace_id}/mentions/{id}', {
		params: { path: { workspace_id: workspaceId, id } }
	});
	if (isSessionUnauthorized(response)) settleQueryUnauthorized(session.authorizationIdentity);
	if (!queryMutationSessionIsCurrent(session) || error)
		throw new Error(m.saved_mentions_save_failed());
	await queryClient.cancelQueries({ queryKey: savedMentionQueryKey(workspaceId), exact: true });
	if (!queryMutationSessionIsCurrent(session)) throw new Error(m.saved_mentions_save_failed());
	queryClient.setQueryData<SavedMention[]>(savedMentionQueryKey(workspaceId), (entries) =>
		(entries ?? []).filter((entry) => entry.id !== id)
	);
}
