<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { z } from 'zod';
	import { client } from '$lib/api/client';
	import { auth } from '$lib/stores/auth';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import {
		captureQueryMutationSession,
		queryMutationSessionIsCurrent
	} from '$lib/query/authorization-boundary';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import InlineNotice from './inline-notice.svelte';
	import { m } from '$lib/paraglide/messages';
	import {
		parseScheduleDateParam,
		workspaceScheduleFromISO,
		workspaceScheduleToISO
	} from './compose/schedule-timezone';
	let {
		publicationIds,
		workspaceId,
		disabled = false
	}: { publicationIds: string[]; workspaceId: string; disabled?: boolean } = $props();
	const itemSchema = z.object({
		publication_id: z.string(),
		expected_revision: z.number(),
		title: z.string().optional(),
		scheduled_at: z.string().optional(),
		preserved: z.boolean(),
		error: z.string().optional()
	});
	const sessionSchema = z.object({
		batchId: z.string(),
		excluded: z.array(z.string()).default([]),
		attempted: z.boolean().default(false),
		timezone: z.string(),
		items: z.array(itemSchema),
		outcomes: z.record(
			z.string(),
			z.object({ state: z.enum(['scheduled', 'failed']), error: z.string().optional() })
		)
	});
	type Item = z.infer<typeof itemSchema>;
	let open = $state(false),
		busy = $state(false),
		error = $state('');
	let startDate = $state(''),
		endDate = $state(''),
		clock = $state('10:00'),
		interval = $state(1),
		useSlots = $state(false);
	let excluded = $state<string[]>([]);
	let attempted = $state(false);
	let invalidDates = $state<string[]>([]);
	let batchId = $state(''),
		timezone = $state('UTC'),
		items = $state<Item[]>([]),
		outcomes = $state<z.infer<typeof sessionSchema>['outcomes']>({});
	const selectionKey = $derived([...publicationIds].sort().join(','));
	const storageKey = $derived(
		`openpost:batch-schedule:${$auth.user?.id}:${workspaceId}:${selectionKey}`
	);
	const remaining = $derived(
		items.filter(
			(item) =>
				!excluded.includes(item.publication_id) &&
				!item.error &&
				outcomes[item.publication_id]?.state !== 'scheduled'
		)
	);
	let restored = '';
	let scopeVersion = 0;
	onDestroy(() => {
		scopeVersion++;
	});
	function scope() {
		const session = captureQueryMutationSession(),
			key = storageKey,
			version = scopeVersion;
		return () =>
			version === scopeVersion && key === storageKey && queryMutationSessionIsCurrent(session);
	}
	$effect(() => {
		const key = storageKey;
		if (restored === key) return;
		restored = key;
		scopeVersion++;
		untrack(() => {
			items = [];
			excluded = [];
			attempted = false;
			invalidDates = [];
			outcomes = {};
			batchId = '';
			error = '';
			busy = false;
			try {
				const parsed = sessionSchema.safeParse(JSON.parse(sessionStorage.getItem(key) ?? '{}'));
				if (parsed.success) {
					({ items, outcomes, batchId, timezone, excluded, attempted } = parsed.data);
				}
			} catch {
				/* Optional device recovery. */
			}
		});
	});
	function persist() {
		try {
			sessionStorage.setItem(
				storageKey,
				JSON.stringify({ batchId, timezone, items, outcomes, excluded, attempted })
			);
		} catch {
			/* Server receipts still prevent duplicate jobs. */
		}
	}
	function show() {
		open = true;
		if (!startDate) {
			const zone = workspaceCtx.settings.timezone || 'UTC';
			const tomorrow = new Date(Date.now() + 86400000),
				end = new Date(Date.now() + 14 * 86400000);
			startDate = tomorrow.toLocaleDateString('en-CA', { timeZone: zone });
			endDate = end.toLocaleDateString('en-CA', { timeZone: zone });
		}
	}
	async function preview() {
		if (busy) return;
		busy = true;
		error = '';
		const current = scope();
		try {
			const [hour, minute] = clock.split(':').map(Number);
			const result = await client.POST('/publications/batch-schedule/preview', {
				body: {
					workspace_id: workspaceId,
					publication_ids: publicationIds,
					start_date: startDate,
					end_date: endDate,
					hour,
					minute,
					interval_days: interval,
					use_slots: useSlots
				}
			});
			if (result.error || !result.data) throw new Error(result.error?.detail || m.batch_failed());
			if (!current()) return;
			items = result.data.items ?? [];
			excluded = [];
			attempted = false;
			invalidDates = [];
			timezone = result.data.timezone;
			batchId = crypto.randomUUID();
			outcomes = {};
			persist();
		} catch (cause) {
			if (current()) error = cause instanceof Error ? cause.message : m.batch_failed();
		} finally {
			if (current()) busy = false;
		}
	}
	async function confirm() {
		if (busy || !remaining.length) return;
		attempted = true;
		busy = true;
		error = '';
		const current = scope();
		persist();
		try {
			const result = await client.POST('/publications/batch-schedule/confirm', {
				body: { workspace_id: workspaceId, batch_id: batchId, items: remaining }
			});
			if (result.error || !result.data) throw new Error(result.error?.detail || m.batch_failed());
			if (!current()) return;
			for (const outcome of result.data) outcomes[outcome.publication_id] = outcome;
			persist();
			ui.invalidatePublications(
				{ workspaceId, scopes: ['activity', 'calendar', 'drafts'] },
				{ immediate: true }
			);
		} catch (cause) {
			if (current()) error = cause instanceof Error ? cause.message : m.batch_failed();
		} finally {
			if (current()) busy = false;
		}
	}
	function editPlan() {
		items = [];
		excluded = [];
		attempted = false;
		invalidDates = [];
		outcomes = {};
		batchId = '';
		persist();
	}
	function localDateTime(value: string) {
		const local = workspaceScheduleFromISO(value, timezone);
		return local ? `${local.date.toString()}T${local.time}` : '';
	}
	function changeDate(item: Item, value: string) {
		const [day, clock] = value.split('T');
		const date = parseScheduleDateParam(day);
		const instant = date && workspaceScheduleToISO(date, clock, timezone);
		if (!instant || Date.parse(instant) <= Date.now()) {
			invalidDates = [...new Set([...invalidDates, item.publication_id])];
			error = m.compose_invalid_timezone_time();
			return;
		}
		invalidDates = invalidDates.filter((id) => id !== item.publication_id);
		error = invalidDates.length ? m.compose_invalid_timezone_time() : '';
		item.scheduled_at = instant;
		persist();
	}
	function formatDate(value: string) {
		return new Intl.DateTimeFormat(undefined, {
			dateStyle: 'medium',
			timeStyle: 'short',
			timeZone: timezone
		}).format(new Date(value));
	}
</script>

<Button
	variant="outline"
	size="sm"
	onclick={show}
	disabled={disabled || !publicationIds.length || publicationIds.length > 20}
	>{m.batch_schedule_selected()}</Button
>
<Dialog.Root bind:open>
	<Dialog.Content class="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-2xl">
		<Dialog.Header
			><Dialog.Title>{m.batch_title()}</Dialog.Title><Dialog.Description
				>{m.batch_description()}</Dialog.Description
			></Dialog.Header
		>
		<div class="min-h-0 space-y-4 overflow-y-auto">
			{#if error}<InlineNotice tone="error" message={error} />{/if}
			{#if !items.length}
				<form
					class="grid gap-4"
					onsubmit={(event) => {
						event.preventDefault();
						void preview();
					}}
				>
					<p class="text-sm text-muted-foreground">{workspaceCtx.settings.timezone || 'UTC'}</p>
					<div class="grid grid-cols-2 gap-3">
						<label class="grid min-w-0 gap-1 text-sm"
							>{m.batch_start()}<Input
								type="date"
								bind:value={startDate}
								required
								disabled={busy}
							/></label
						><label class="grid min-w-0 gap-1 text-sm"
							>{m.batch_end()}<Input
								type="date"
								bind:value={endDate}
								min={startDate}
								required
								disabled={busy}
							/></label
						>
					</div>
					<label class="flex min-h-11 items-center gap-3 text-sm"
						><Checkbox bind:checked={useSlots} disabled={busy} />{m.batch_use_slots()}</label
					>
					{#if !useSlots}<div class="grid grid-cols-2 gap-3">
							<label class="grid gap-1 text-sm"
								>{m.batch_time()}<Input
									type="time"
									bind:value={clock}
									required
									disabled={busy}
								/></label
							><label class="grid gap-1 text-sm"
								>{m.batch_interval()}<Input
									type="number"
									bind:value={interval}
									min={1}
									max={30}
									required
									disabled={busy}
								/></label
							>
						</div>{/if}
					<Button type="submit" disabled={busy || !publicationIds.length}
						>{busy ? m.common_loading() : m.batch_preview()}</Button
					>
				</form>
			{:else}
				<p class="text-sm text-muted-foreground">{timezone} · {m.batch_timing_note()}</p>
				<ol class="divide-y">
					{#each items as item (item.publication_id)}{@const outcome =
							outcomes[item.publication_id]}
						<li class="space-y-1 py-3">
							<label class="flex min-h-11 items-center gap-3 font-medium">
								<Checkbox
									aria-label={`${m.batch_select_post()}: ${item.title || item.publication_id}`}
									checked={!excluded.includes(item.publication_id)}
									disabled={busy || outcome?.state === 'scheduled'}
									onCheckedChange={(checked) => {
										excluded = checked
											? excluded.filter((id) => id !== item.publication_id)
											: [...excluded, item.publication_id];
										persist();
									}}
								/>{item.title || item.publication_id}
							</label>
							{#if item.scheduled_at}<p class="text-sm">
									{formatDate(item.scheduled_at)}{item.preserved ? ` · ${m.batch_preserved()}` : ''}
								</p>{/if}
							{#if item.scheduled_at && !item.preserved && !item.error && !attempted}
								<Input
									type="datetime-local"
									aria-label={`${m.batch_time()}: ${item.title || item.publication_id}`}
									value={localDateTime(item.scheduled_at)}
									disabled={busy || excluded.includes(item.publication_id)}
									onchange={(event) => changeDate(item, event.currentTarget.value)}
								/>
							{/if}{#if item.error || outcome?.error}<InlineNotice
									tone="error"
									message={item.error || outcome?.error || ''}
								/>{:else if outcome?.state === 'scheduled'}<p class="text-sm" role="status">
									{m.batch_scheduled()}
								</p>{/if}
						</li>{/each}
				</ol>
				<div class="flex flex-wrap gap-2">
					<Button
						onclick={() => void confirm()}
						disabled={busy ||
							invalidDates.some((id) => !excluded.includes(id)) ||
							!remaining.length}>{busy ? m.common_loading() : m.batch_confirm()}</Button
					><Button variant="ghost" onclick={editPlan} disabled={busy}>{m.batch_edit_dates()}</Button
					>
				</div>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
