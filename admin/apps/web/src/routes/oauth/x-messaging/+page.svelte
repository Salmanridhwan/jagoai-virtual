<script lang="ts">
	import { appBranding } from '$lib/app-branding.svelte';
	import { onMount } from 'svelte';
	import { auth } from '$lib/stores/auth';
	import { client } from '$lib/api/client';
	import {
		takeXMessagingCallback,
		takeXMessagingAuthorization,
		xMessagingSettingsHref
	} from '$lib/auth/x-messaging';
	import { queryClient } from '$lib/query/client';
	import { xMessagingQueryKeys } from '@openpost/query-catalog';
	import { m } from '$lib/paraglide/messages';
	import StandaloneShell from '$lib/components/standalone-shell.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { Button } from '$lib/components/ui/button';

	let mounted = $state(false);
	let started = false;
	let initiatingActor = '';
	let status = $state<'loading' | 'success' | 'error'>('loading');
	let error = $state('');
	let returnHref = $state(xMessagingSettingsHref());
	onMount(() => {
		mounted = true;
	});
	$effect(() => {
		const actorId = $auth.user?.id ?? '';
		if (started && actorId !== initiatingActor) {
			status = 'error';
			error = m.x_messaging_callback_identity();
			return;
		}
		if (!mounted || $auth.isLoading || started) return;
		initiatingActor = actorId;
		started = true;
		const callback = takeXMessagingCallback();
		const pending = takeXMessagingAuthorization(callback?.state ?? '', actorId);
		if (pending) returnHref = xMessagingSettingsHref(pending.workspaceId, pending.accountId);
		if (callback?.cancelled) {
			status = 'error';
			error = m.x_messaging_callback_cancelled();
			return;
		}
		if (!actorId || !pending) {
			status = 'error';
			error = m.x_messaging_callback_identity();
			return;
		}
		if (!callback?.state || !callback.code) {
			status = 'error';
			error = m.x_messaging_callback_failed();
			return;
		}
		const identity = auth.captureIdentity();
		const controller = new AbortController();
		void (async () => {
			try {
				const { data, error: problem } = await client.POST('/accounts/x/messaging/complete', {
					body: { state: callback.state, code: callback.code },
					signal: controller.signal
				});
				if (controller.signal.aborted) return;
				if (!identity || !auth.isIdentityCurrent(identity)) {
					status = 'error';
					error = m.x_messaging_callback_identity();
					return;
				}
				if (problem || !data || data.workspace_id !== pending.workspaceId) {
					status = 'error';
					error = m.x_messaging_callback_failed();
					return;
				}
				await queryClient.invalidateQueries({
					queryKey: xMessagingQueryKeys.readiness(pending.workspaceId, pending.accountId)
				});
				status = 'success';
			} catch {
				if (!controller.signal.aborted) {
					status = 'error';
					error = m.x_messaging_callback_failed();
				}
			}
		})();
		return () => controller.abort();
	});
</script>

<svelte:head
	><title>{m.x_messaging_title()} | {appBranding.profile.display_name}</title><meta
		name="referrer"
		content="no-referrer"
	/></svelte:head
>
<StandaloneShell
	title={status === 'loading'
		? m.x_messaging_callback_loading()
		: status === 'success'
			? m.x_messaging_callback_success()
			: m.x_messaging_title()}
	description={status === 'success'
		? m.x_messaging_callback_success_description()
		: m.x_messaging_description()}
>
	{#if status === 'error'}<InlineNotice tone="error" message={error} />{/if}
	{#if status !== 'loading'}<Button href={returnHref} class="mt-4">{m.x_messaging_return()}</Button
		>{/if}
</StandaloneShell>
