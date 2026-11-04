import { appBrandingQueryOptions, type AppBrandingQueryAPI } from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import { queryGET } from './transport';

export const appBrandingQueryAPI: AppBrandingQueryAPI = {
	async getAppBranding(workspaceId, signal) {
		const { data } = await queryGET({
			signal,
			fallback: 'Unable to load app branding',
			request: (signal) =>
				client.GET('/app-branding/{workspace_id}', {
					params: { path: { workspace_id: workspaceId } },
					signal
				})
		});
		return data;
	}
};
export function workspaceAppBrandingOptions(workspaceId: string) {
	return appBrandingQueryOptions(appBrandingQueryAPI, workspaceId);
}
