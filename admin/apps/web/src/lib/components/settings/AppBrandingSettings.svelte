<script lang="ts">
	import {
		registerSettingsInitialLoad,
		SETTINGS_INITIAL_LOAD_PARTICIPANT
	} from '$lib/settings-initial-load.svelte';
	import { getOptionalUnsavedChanges } from '$lib/unsaved-changes.svelte';
	import { createQuery } from '@tanstack/svelte-query';
	import { appBrandingQueryKey, type AppBrandingProfileInput } from '@openpost/query-catalog';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { workspaceAppBrandingOptions } from '$lib/query/app-branding';
	import {
		captureQueryMutationSession,
		queryMutationSessionIsCurrent
	} from '$lib/query/authorization-boundary';
	import { reconcileQueryMutation } from '$lib/query/mutation-reconciliation';
	import { client } from '$lib/api/client';
	import { queryClient } from '$lib/query/client';
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import Editor from './app-branding-editor.svelte';
	let { workspaceOnly = false }: { workspaceOnly?: boolean } = $props();
	const workspaceID = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	const query = createQuery(() => workspaceAppBrandingOptions(workspaceID));
	const reportInitialLoad = registerSettingsInitialLoad(
		SETTINGS_INITIAL_LOAD_PARTICIPANT.appBranding
	);
	$effect(() => reportInitialLoad(workspaceOnly && query.isPending && !query.data));
	const unsavedChanges = getOptionalUnsavedChanges();
	function selectScope(scope: 'organization' | 'workspace') {
		if (scope === selected || !unsavedChanges || unsavedChanges.confirmDiscard()) {
			selected = scope;
			notice = '';
		}
	}
	let savedCount = $state(0);
	let notice = $state('');
	let selected = $state<'organization' | 'workspace'>('organization');
	const organization = $derived(
		!workspaceOnly && selected === 'organization' && Boolean(query.data?.can_manage_organization)
	);
	async function save(
		profile: AppBrandingProfileInput | null,
		allow: boolean,
		expectedRevision: number
	) {
		const session = captureQueryMutationSession();
		const target = workspaceID;
		const settings = query.data;
		if (!settings) return;
		const org = organization;
		const { data, error } = await client.PUT(
			org ? '/app-branding/{workspace_id}/organization' : '/app-branding/{workspace_id}/workspace',
			{
				params: { path: { workspace_id: target } },
				body: {
					expected_revision: expectedRevision,
					profile: profile ?? undefined,
					allow_workspace_override: allow
				}
			}
		);
		if (error || !data) throw new Error(error?.detail ?? m.app_branding_save_error());
		if (!queryMutationSessionIsCurrent(session)) return;
		// Invalidate every cached workspace affected by an organization default/policy.
		const affected = org
			? [
					...new Set([
						target,
						...workspaceCtx.workspaces
							.filter((w) => w.organization_id === settings.organization_id)
							.map((w) => w.id)
					])
				]
			: [target];
		const current = await reconcileQueryMutation(queryClient, session, {
			cancel: affected.map((id) => ({ queryKey: appBrandingQueryKey(id) })),
			reconcile: () => queryClient.setQueryData(appBrandingQueryKey(target), data),
			invalidate: affected
				.filter((id) => id !== target)
				.map((id) => ({ queryKey: appBrandingQueryKey(id), refetchType: 'none' as const }))
		});
		if (!current) return;
		if (workspaceID === target && organization === org) {
			savedCount++;
			notice = m.app_branding_saved();
		}
		for (const id of affected)
			if (id !== target)
				void queryClient.refetchQueries({ queryKey: appBrandingQueryKey(id), type: 'active' });
	}
</script>

<section class="space-y-5" aria-labelledby="app-branding-heading">
	<div class="space-y-1" hidden={workspaceOnly}>
		<h2 id="app-branding-heading" class="text-lg font-semibold">{m.app_branding_title()}</h2>
		<p class="max-w-2xl text-sm text-muted-foreground">{m.app_branding_description()}</p>
	</div>
	{#if notice}<InlineNotice tone="success" message={notice} />{/if}
	{#if query.isError}<InlineNotice tone="error" message={m.app_branding_load_error()}
			><Button variant="outline" onclick={() => void query.refetch()}>{m.common_retry()}</Button
			></InlineNotice
		>{/if}
	{#if query.isPending && !query.data}<PageLoading
			layout="sections"
			label={m.common_loading()}
		/>{:else if query.data}
		{#if !workspaceOnly && query.data.can_manage_organization}
			<div class="flex flex-wrap gap-2" aria-label={m.app_branding_scope()}>
				<Button
					variant={organization ? 'default' : 'outline'}
					aria-pressed={organization}
					onclick={() => selectScope('organization')}>{m.app_branding_organization()}</Button
				>
				<Button
					variant={!organization ? 'default' : 'outline'}
					aria-pressed={!organization}
					onclick={() => selectScope('workspace')}>{m.app_branding_workspace()}</Button
				>
			</div>
		{/if}
		{#key `${workspaceID}:${organization}:${savedCount}`}
			<Editor settings={query.data} {organization} onSave={save} />
		{/key}
	{/if}
</section>
