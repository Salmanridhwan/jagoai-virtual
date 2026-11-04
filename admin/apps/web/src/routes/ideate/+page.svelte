<script lang="ts">
	import { untrack } from 'svelte';
	let opened = false;
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ideate } from '$lib/post-builder/ideate.svelte';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { resolveAppPath } from '$lib/app-path';

	$effect(() => {
		const workspaceId = workspaceCtx.currentWorkspace?.id;
		if (!workspaceId || opened) return;
		opened = true;
		untrack(() => {
			const buildId = page.url.searchParams.get('build') ?? undefined;
			if (workspaceCtx.currentWorkspace?.can_edit)
				ideate.show({ workspaceId, contextKey: buildId ?? 'navigation', buildId });
			void goto(resolveAppPath('/publications'), { replaceState: true, keepFocus: true });
		});
	});
</script>
