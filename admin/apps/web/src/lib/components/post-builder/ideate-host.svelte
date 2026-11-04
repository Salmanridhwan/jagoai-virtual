<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { ideate } from '$lib/post-builder/ideate.svelte';
	import { auth } from '$lib/stores/auth';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { Button } from '$lib/components/ui/button';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { z } from 'zod';
	import { m } from '$lib/paraglide/messages';
	import type IdeateDialog from './ideate-dialog.svelte';
	let component = $state<typeof IdeateDialog>();
	let loading = false;
	let loadError = $state(false);
	let owner = '';
	const entrySchema = z.object({
		contextKey: z.string(),
		buildId: z.string().optional(),
		open: z.boolean()
	});
	const identity = $derived(`${$auth.user?.id ?? ''}:${workspaceCtx.currentWorkspace?.id ?? ''}`);
	$effect(() => {
		const next = identity;
		const canEdit = workspaceCtx.currentWorkspace?.can_edit;
		untrack(() => {
			if ((owner && owner !== next) || !canEdit) ideate.reset();
			if (owner !== next && canEdit && workspaceCtx.currentWorkspace?.id) {
				try {
					const parsed = entrySchema.safeParse(
						JSON.parse(sessionStorage.getItem(`openpost:ideate:last:${next}`) ?? '{}')
					);
					if (parsed.success && !ideate.entry) {
						ideate.show({
							workspaceId: workspaceCtx.currentWorkspace.id,
							contextKey: parsed.data.contextKey,
							buildId: parsed.data.buildId
						});
						ideate.open = parsed.data.open;
						load();
					}
				} catch {
					/* Device recovery is optional. */
				}
			}
			owner = next;
		});
	});
	$effect(() => {
		const entry = ideate.entry,
			open = ideate.open,
			key = identity;
		if (!entry || entry.workspaceId !== workspaceCtx.currentWorkspace?.id) return;
		try {
			sessionStorage.setItem(
				`openpost:ideate:last:${key}`,
				JSON.stringify({ contextKey: entry.contextKey, buildId: entry.buildId, open })
			);
		} catch {
			/* Server builds retain their own durable state. */
		}
	});
	function load() {
		loading = true;
		loadError = false;
		void import('./ideate-dialog.svelte')
			.then((module) => {
				component = module.default;
			})
			.catch(() => {
				loadError = true;
			})
			.finally(() => {
				loading = false;
			});
	}
	$effect(() => {
		if (!ideate.open || component || loading || loadError) return;
		load();
	});
	onDestroy(() => ideate.reset());
</script>

{#if loadError && ideate.open}
	<InlineNotice tone="error" message={m.compose_ai_build_failed()}
		>{#snippet actions()}<Button variant="ghost" onclick={load}>{m.common_retry()}</Button
			>{/snippet}</InlineNotice
	>
{/if}
{#if component && workspaceCtx.currentWorkspace?.can_edit}
	{@const Component = component}
	{#key identity}<Component />{/key}
{/if}
{#if !ideate.open && ideate.status !== 'idle'}
	<div class="fixed right-4 bottom-[calc(var(--mobile-bottom-nav-clearance,0px)+1rem)] z-30">
		<Button variant="secondary" onclick={() => ideate.show()}
			>{m.compose_ai_ideate()} · {ideate.status === 'working'
				? m.ideate_generating()
				: m.ideate_resume()}</Button
		>
	</div>
{/if}
