<script lang="ts">
	import { onMount } from 'svelte';
	import { startInboxUpdates, type InboxView } from '@openpost/query-catalog';
	import { auth } from '$lib/stores/auth';
	import { queryClient } from '$lib/query/client';
	import { inboxUpdateAPI } from '$lib/query/inbox';
	import { m } from '$lib/paraglide/messages';
	import InlineNotice from '$lib/components/inline-notice.svelte';

	let {
		workspaceId,
		view,
		conversationId = '',
		viewKey = ''
	}: {
		workspaceId: string;
		view: InboxView;
		conversationId?: string;
		viewKey?: string;
	} = $props();
	let foreground = $state(false);
	let online = $state(false);
	let clientId = $state('');
	let failed = $state(false);

	onMount(() => {
		clientId = crypto.randomUUID();
		const update = () => {
			foreground = document.visibilityState === 'visible';
			online = navigator.onLine;
		};
		update();
		document.addEventListener('visibilitychange', update);
		window.addEventListener('online', update);
		window.addEventListener('offline', update);
		return () => {
			document.removeEventListener('visibilitychange', update);
			window.removeEventListener('online', update);
			window.removeEventListener('offline', update);
		};
	});
	$effect(() => {
		const identity = $auth.user?.id;
		// Filter changes retire the previous view's pending responses as well.
		void viewKey;
		if (!identity || !workspaceId || !clientId || !foreground || !online) return;
		const controller = new AbortController();
		failed = false;
		const stop = startInboxUpdates({
			api: {
				...inboxUpdateAPI,
				async inboxChanges(workspaceId, cursor, signal) {
					const page = await inboxUpdateAPI.inboxChanges(workspaceId, cursor, signal);
					if (!signal.aborted) failed = false;
					return page;
				}
			},
			queryClient,
			workspaceId,
			clientId,
			view,
			conversationId,
			signal: controller.signal,
			onError: () => {
				if (!controller.signal.aborted) failed = true;
			}
		});
		return () => {
			controller.abort();
			stop();
		};
	});
</script>

{#if failed}
	<InlineNotice tone="warning" message={m.inbox_updates_reconnecting()} />
{/if}
