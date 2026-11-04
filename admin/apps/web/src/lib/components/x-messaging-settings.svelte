<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { xMessagingReadinessQueryOptions } from '@openpost/query-catalog';
	import { client } from '$lib/api/client';
	import { xMessagingQueryAPI } from '$lib/query/inbox';
	import { auth } from '$lib/stores/auth';
	import { rememberXMessagingAuthorization } from '$lib/auth/x-messaging';
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import InlineNotice from '$lib/components/inline-notice.svelte';

	let {
		workspaceId,
		accountId,
		canConnect
	}: { workspaceId: string; accountId: string; canConnect: boolean } = $props();
	let busy = $state(false);
	let error = $state('');
	const readiness = createQuery(() =>
		xMessagingReadinessQueryOptions(xMessagingQueryAPI, workspaceId, accountId)
	);
	async function authorize() {
		const identity = auth.captureIdentity();
		if (busy || !canConnect || !identity) return;
		const scope = `${workspaceId}:${accountId}`;
		busy = true;
		error = '';
		try {
			const { data, error: problem } = await client.POST(
				'/accounts/{account_id}/messaging/x/authorize',
				{
					params: { path: { account_id: accountId } },
					body: { workspace_id: workspaceId }
				}
			);
			if (!auth.isIdentityCurrent(identity) || scope !== `${workspaceId}:${accountId}`) return;
			if (problem || !data?.url) {
				error = m.x_messaging_authorize_failed();
				return;
			}
			rememberXMessagingAuthorization(data.url, identity.userID, workspaceId, accountId);
			window.location.assign(data.url);
		} catch {
			if (auth.isIdentityCurrent(identity) && scope === `${workspaceId}:${accountId}`)
				error = m.x_messaging_authorize_failed();
		} finally {
			busy = false;
		}
	}
</script>

<section class="space-y-3 border-t pt-4" aria-label={m.x_messaging_title()}>
	<h3 class="text-sm font-semibold">{m.x_messaging_title()}</h3>
	<p class="text-sm leading-6 text-muted-foreground">{m.x_messaging_description()}</p>
	{#if readiness.isPending}
		<p class="text-sm text-muted-foreground">{m.common_loading()}</p>
	{:else if readiness.isError}
		<InlineNotice tone="error" message={m.x_messaging_load_failed()}>
			{#snippet actions()}<Button
					variant="outline"
					size="sm"
					onclick={() => void readiness.refetch()}>{m.common_retry()}</Button
				>{/snippet}
		</InlineNotice>
	{:else if readiness.data}
		{@const ready = readiness.data}
		{#if ready.authorized}
			<p class="text-sm">{m.x_messaging_authorized()}</p>
			<p class="text-sm text-muted-foreground">
				{ready.can_send ? m.x_messaging_send_ready() : m.x_messaging_send_unavailable()}
			</p>
		{:else}
			<p class="text-sm">
				{ready.reason === 'oauth2_app_required'
					? m.x_messaging_app_required()
					: ready.reason === 'oauth2_authorization_required'
						? m.x_messaging_authorization_required()
						: m.x_messaging_reconnect_required()}
			</p>
		{/if}
		{#if ready.authorized}
			<p class="text-sm leading-6 text-muted-foreground">
				{ready.can_subscribe ? m.x_messaging_events_ready() : m.x_messaging_events_closed()}
			</p>
		{/if}
		<Button
			variant="outline"
			onclick={authorize}
			disabled={busy || !canConnect || ready.reason === 'oauth2_app_required'}
		>
			{busy
				? m.common_loading()
				: ready.authorized
					? m.x_messaging_reauthorize()
					: m.x_messaging_authorize()}
		</Button>
	{/if}
	{#if error}<InlineNotice tone="error" message={error} />{/if}
	<p class="text-xs leading-5 text-muted-foreground">{m.x_messaging_no_auto_subscription()}</p>
</section>
