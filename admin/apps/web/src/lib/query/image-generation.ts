import type { components } from '@openpost/api-contract';
import {
	createOpenPostQueryError,
	imageGenerationConfigOptions,
	imageGenerationHistoryOptions,
	imageGenerationKeys,
	type ImageGenerationRun
} from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import { m } from '$lib/paraglide/messages';
import { queryGET } from './transport';
import { queryClient } from './client';
import { captureQueryMutationSession, settleQueryMutationSession } from './authorization-boundary';

export type ImageGenerationRequest = components['schemas']['ImageGenerationRequest'];
export type { ImageGenerationRun };

export function imageGenerationConfigQuery(actorId: string) {
	return imageGenerationConfigOptions(async (signal) => {
		const { data } = await queryGET({
			signal,
			fallback: m.image_ai_failed(),
			request: (signal) => client.GET('/image-generations/config', { signal })
		});
		return data;
	}, actorId);
}

export function imageGenerationHistoryQuery(
	workspaceId: string,
	actorId: string,
	projectId: string
) {
	return imageGenerationHistoryOptions(
		async (signal) => {
			const { data } = await queryGET({
				signal,
				fallback: m.image_ai_failed(),
				request: (signal) =>
					client.GET('/image-generations', {
						params: { query: { workspace_id: workspaceId, project_id: projectId } },
						signal
					})
			});
			return data.runs ?? [];
		},
		workspaceId,
		actorId,
		projectId
	);
}

export async function createImageGeneration(
	request: ImageGenerationRequest,
	actorId: string,
	key: string
) {
	const session = captureQueryMutationSession();
	const { data, error, response } = await client.POST('/image-generations', {
		params: { header: { 'Idempotency-Key': key } },
		body: request
	});
	if (!settleQueryMutationSession(session, response))
		throw new DOMException('The signed-in account changed.', 'AbortError');
	if (error || !data) throw createOpenPostQueryError(response.status, error, m.image_ai_failed());
	const queryKey = imageGenerationKeys.history(request.workspace_id, actorId, request.project_id);
	queryClient.setQueryData<ImageGenerationRun[]>(queryKey, (previous) => [
		data,
		...(previous ?? []).filter((run) => run.id !== data.id)
	]);
	await queryClient.invalidateQueries({ queryKey });
	return data;
}
