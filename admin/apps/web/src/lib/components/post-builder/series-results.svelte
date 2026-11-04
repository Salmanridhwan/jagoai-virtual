<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { createQueries, queryOptions } from '@tanstack/svelte-query';
	import { publicationBuildQueryOptions, publicationBuildKeys } from '@openpost/query-catalog';
	import { publicationBuildQueryAPI } from '$lib/query/publication-builds';
	import { queryClient } from '$lib/query/client';
	import { client } from '$lib/api/client';
	import {
		captureQueryMutationSession,
		queryMutationSessionIsCurrent
	} from '$lib/query/authorization-boundary';
	import BatchScheduleDialog from '$lib/components/batch-schedule-dialog.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { auth } from '$lib/stores/auth';
	import {
		commitPublicationOption,
		getPublicationBuild,
		retryPublicationBuild,
		type PublicationBuild
	} from '$lib/post-builder/client';
	import { renderOptionMedia } from '$lib/post-builder/visuals';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { resolveAppPath } from '$lib/app-path';
	import { m } from '$lib/paraglide/messages';
	import { z } from 'zod';
	let {
		build,
		onUpdated,
		onOpen,
		onWorking
	}: {
		build: PublicationBuild;
		onUpdated: (build: PublicationBuild) => void;
		onOpen: (id: string) => void;
		onWorking: (working: boolean) => void;
	} = $props();
	type Concept = NonNullable<NonNullable<PublicationBuild['result']>['series']>[number];
	let selection = $state<Record<string, boolean>>({});
	let edits = $state<Record<string, { title: string; brief: string }>>({});
	let errors = $state<Record<string, string>>({});
	let busy = $state(false);
	let destroyed = false;
	const controller = new AbortController();
	const concepts = $derived(build.result?.series ?? []);
	const children = createQueries(() => ({
		queries: concepts.map((item) =>
			queryOptions({
				...publicationBuildQueryOptions(
					publicationBuildQueryAPI,
					build.workspace_id,
					item.child_build_id ?? ''
				),
				refetchInterval: (query) =>
					query.state.data?.state === 'queued' || query.state.data?.state === 'building'
						? 1500
						: false
			})
		)
	}));
	const working = $derived(
		busy ||
			children.some((query) => query.data?.state === 'queued' || query.data?.state === 'building')
	);
	const selected = $derived(concepts.filter((item) => selection[item.id] !== false));
	const storageKey = $derived(
		`openpost:series:${$auth.user?.id}:${build.workspace_id}:${build.id}`
	);
	const storedSchema = z.object({
		selection: z.record(z.string(), z.boolean()),
		edits: z.record(z.string(), z.object({ title: z.string(), brief: z.string() }))
	});
	let restored = '';
	$effect(() => {
		const key = storageKey;
		if (key === restored) return;
		restored = key;
		untrack(() => {
			try {
				const parsed = storedSchema.safeParse(JSON.parse(sessionStorage.getItem(key) ?? '{}'));
				if (parsed.success) {
					selection = parsed.data.selection;
					edits = parsed.data.edits;
				}
			} catch {
				/* Device storage is optional. */
			}
		});
	});
	$effect(() => {
		const value = JSON.stringify({ selection, edits });
		try {
			sessionStorage.setItem(storageKey, value);
		} catch {
			/* Server concepts and drafts remain recoverable. */
		}
	});
	$effect(() => onWorking(working));
	function scope() {
		const session = captureQueryMutationSession(),
			id = build.id;
		return () => !destroyed && build.id === id && queryMutationSessionIsCurrent(session);
	}
	function edit(item: Concept, key: 'title' | 'brief', value: string) {
		edits[item.id] = {
			title: edits[item.id]?.title ?? item.title,
			brief: edits[item.id]?.brief ?? item.brief,
			[key]: value
		};
	}
	async function refresh(current: () => boolean) {
		const next = await getPublicationBuild(build.id);
		if (current()) {
			onUpdated(next);
			await queryClient.invalidateQueries({
				queryKey: publicationBuildKeys.detail(build.workspace_id, build.id)
			});
		}
	}
	async function generate(items: Concept[]) {
		if (busy) return;
		busy = true;
		const current = scope();
		try {
			for (const item of items) {
				if (!current()) return;
				if (item.child_build_id && children[concepts.indexOf(item)]?.data) continue;
				errors[item.id] = '';
				try {
					let revision = item.revision;
					const edited = edits[item.id];
					if (edited && (edited.title !== item.title || edited.brief !== item.brief)) {
						const result = await client.PUT('/publication-builds/{id}/series/{item_id}', {
							params: { path: { id: build.id, item_id: item.id } },
							body: { expected_revision: revision, ...edited }
						});
						if (!current()) return;
						if (result.error || !result.data)
							throw new Error(result.error?.detail || m.series_failed());
						const saved = result.data.result?.series?.find((entry) => entry.id === item.id);
						if (!saved) throw new Error(m.series_failed());
						revision = saved.revision;
					}
					const result = await client.POST('/publication-builds/{id}/series/{item_id}/generate', {
						params: { path: { id: build.id, item_id: item.id } },
						body: { expected_revision: revision }
					});
					if (!current()) return;
					if (result.error || !result.data)
						throw new Error(result.error?.detail || m.series_failed());
				} catch (cause) {
					if (current())
						errors[item.id] = cause instanceof Error ? cause.message : m.series_failed();
				}
				try {
					await refresh(current);
				} catch (cause) {
					if (current())
						errors[item.id] = cause instanceof Error ? cause.message : m.series_failed();
				}
			}
		} finally {
			if (current()) busy = false;
		}
	}
	async function retry(item: Concept) {
		if (!item.child_build_id || busy) return;
		const current = scope();
		busy = true;
		try {
			await retryPublicationBuild(item.child_build_id);
			await refresh(current);
			await queryClient.invalidateQueries({
				queryKey: publicationBuildKeys.detail(build.workspace_id, item.child_build_id)
			});
		} catch (cause) {
			if (current()) errors[item.id] = cause instanceof Error ? cause.message : m.series_failed();
		} finally {
			if (current()) busy = false;
		}
	}
	async function saveSelected() {
		if (busy) return;
		const current = scope();
		busy = true;
		try {
			for (const item of selected) {
				if (!item.child_build_id || !current()) continue;
				try {
					const child = await getPublicationBuild(item.child_build_id);
					if (!current()) return;
					if (child.state === 'committed') continue;
					const option = child.result?.options?.[0];
					if (child.state !== 'ready' || !option) continue;
					const media = await renderOptionMedia(
						build.workspace_id,
						option,
						undefined,
						controller.signal
					);
					if (!current()) return;
					await commitPublicationOption(child.id, option.id, media, option, child.revision);
					if (!current()) return;
					ui.invalidatePublications();
					await queryClient.invalidateQueries({
						queryKey: publicationBuildKeys.detail(build.workspace_id, child.id)
					});
				} catch (cause) {
					if (current())
						errors[item.id] = cause instanceof Error ? cause.message : m.series_failed();
				}
			}
		} finally {
			if (current()) busy = false;
		}
	}
	onDestroy(() => {
		destroyed = true;
		controller.abort();
	});
</script>

<section class="grid gap-4" aria-label={m.series_title()}>
	<p class="text-sm text-muted-foreground">{m.series_description()}</p>
	{#each concepts as item, index (item.id)}
		{@const child = children[index]?.data}
		<article class="grid min-w-0 gap-3 rounded-lg border p-4">
			<label class="flex min-h-11 items-center gap-3"
				><Checkbox
					checked={selection[item.id] !== false}
					onCheckedChange={(checked) => (selection[item.id] = checked === true)}
					disabled={busy}
				/><span class="font-medium">{item.title}</span></label
			>
			{#if !item.child_build_id}
				<label class="grid gap-1 text-sm"
					>{m.series_post_title()}<Input
						value={edits[item.id]?.title ?? item.title}
						oninput={(event) => edit(item, 'title', event.currentTarget.value)}
						maxlength={200}
						disabled={busy}
					/></label
				>
				<label class="grid gap-1 text-sm"
					>{m.series_brief()}<Textarea
						value={edits[item.id]?.brief ?? item.brief}
						oninput={(event) => edit(item, 'brief', event.currentTarget.value)}
						maxlength={1500}
						disabled={busy}
					/></label
				>
			{:else}<p class="text-sm whitespace-pre-wrap">{item.brief}</p>{/if}
			<p class="text-sm text-muted-foreground">{item.evidence}</p>
			<p class="text-xs text-muted-foreground">
				{(item.source_refs ?? [])
					.map((ref) => build.result?.sources?.find((source) => source.id === ref)?.label ?? ref)
					.join(' · ')}
			</p>
			{#if errors[item.id]}<InlineNotice tone="error" message={errors[item.id]} />{/if}
			{#if child?.state === 'committed'}<Button
					variant="outline"
					href={resolveAppPath(`/publications/${child.publication_id}`)}
					>{m.ideate_open_draft()}</Button
				>
			{:else if child?.state === 'ready'}<Button
					variant="outline"
					onclick={() => onOpen(child.id)}
					disabled={busy}>{m.series_edit_post()}</Button
				>
			{:else if child?.state === 'queued' || child?.state === 'building'}<p
					class="text-sm"
					role="status"
				>
					{m.ideate_generating()}
				</p>
			{:else if child?.state === 'failed' || child?.state === 'cancelled'}<InlineNotice
					tone="error"
					message={child.error_message || m.series_failed()}
				/><Button variant="outline" onclick={() => void retry(item)} disabled={busy}
					>{m.common_retry()}</Button
				>
			{:else if item.child_build_id}<Button
					variant="outline"
					onclick={() => void generate([item])}
					disabled={busy}>{m.ideate_resume()}</Button
				>{/if}
		</article>
	{/each}
	<div class="flex flex-wrap gap-2">
		<Button
			onclick={() => void generate(selected)}
			disabled={busy ||
				!selected.some(
					(item) => !item.child_build_id || Boolean(children[concepts.indexOf(item)]?.error)
				)}>{m.series_generate_selected()}</Button
		>
		<Button
			variant="outline"
			onclick={() => void saveSelected()}
			disabled={busy ||
				!selected.some((item) => children[concepts.indexOf(item)]?.data?.state === 'ready')}
			>{m.series_save_selected()}</Button
		>
		<BatchScheduleDialog
			workspaceId={build.workspace_id}
			publicationIds={selected.flatMap((item) => {
				const child = children[concepts.indexOf(item)]?.data;
				return child?.state === 'committed' && child.publication_id ? [child.publication_id] : [];
			})}
			disabled={busy}
		/>
	</div>
</section>
