<script lang="ts">
	import { untrack } from 'svelte';
	import { createQuery } from '@tanstack/svelte-query';
	import {
		voiceProfilesQueryOptions,
		voiceProfileQueryKeys,
		workspaceAccountsQueryOptions,
		type VoiceProfile
	} from '@openpost/query-catalog';
	import { voiceProfileQueryAPI } from '$lib/query/voice-profiles';
	import { queryAPI } from '$lib/query/api';
	import { queryClient } from '$lib/query/client';
	import { client } from '$lib/api/client';
	import {
		captureQueryMutationSession,
		settleQueryMutationSession
	} from '$lib/query/authorization-boundary';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import AppSelect from '$lib/components/app-select.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { formatSocialAccountLabel } from '$lib/utils';
	import { m } from '$lib/paraglide/messages';
	let { workspaceId }: { workspaceId: string } = $props();
	const canEdit = $derived(
		workspaceCtx.currentWorkspace?.id === workspaceId && workspaceCtx.currentWorkspace.can_edit
	);
	const profiles = createQuery(() => voiceProfilesQueryOptions(voiceProfileQueryAPI, workspaceId));
	const accounts = createQuery(() => workspaceAccountsQueryOptions(queryAPI, workspaceId));
	let initializedWorkspace = '';
	let selected = $state.raw<VoiceProfile>();
	let name = $state('');
	let identity = $state('');
	let language = $state('');
	let guidance = $state('');
	let humor = $state('');
	let formality = $state('');
	let vocabulary = $state('');
	let avoidances = $state('');
	let examples = $state<string[]>([]);
	let isDefault = $state(false);
	let busy = $state(false);
	let error = $state('');
	let saved = $state(false);
	function edit(profile?: VoiceProfile) {
		selected = profile;
		name = profile?.name ?? '';
		identity = profile?.definition.identity_summary ?? '';
		language = profile?.definition.preferred_language ?? '';
		guidance = profile?.definition.traits?.join('\n') ?? '';
		humor = profile?.definition.humor ?? '';
		formality = profile?.definition.formality ?? '';
		vocabulary = profile?.definition.vocabulary?.join('\n') ?? '';
		avoidances = profile?.definition.forbidden_phrases?.join('\n') ?? '';
		examples = profile?.definition.examples?.map((example) => example.text) ?? [];
		isDefault = profile?.is_default ?? false;
		error = '';
		saved = false;
	}
	function lines(value: string) {
		return value
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean);
	}
	async function save() {
		if (!canEdit || !name.trim() || busy) return;
		const workspace = workspaceId;
		const session = captureQueryMutationSession();
		busy = true;
		error = '';
		saved = false;
		const definition = {
			...selected?.definition,
			identity_summary: identity.trim(),
			preferred_language: language.trim(),
			traits: lines(guidance),
			humor: humor.trim(),
			formality: formality.trim(),
			vocabulary: lines(vocabulary),
			forbidden_phrases: lines(avoidances),
			examples: examples
				.map((text, i) => ({ ...selected?.definition.examples?.[i], text: text.trim() }))
				.filter((example) => example.text)
		};
		try {
			const result = selected
				? await client.PUT('/voice-profiles/{id}', {
						params: { path: { id: selected.id } },
						body: {
							workspace_id: workspace,
							expected_revision: selected.revision,
							name: name.trim(),
							definition
						}
					})
				: await client.POST('/voice-profiles', {
						body: { workspace_id: workspace, name: name.trim(), is_default: isDefault, definition }
					});
			if (
				!settleQueryMutationSession(session, result.response) ||
				workspace !== workspaceCtx.currentWorkspace?.id
			)
				return;
			if (result.error || !result.data)
				throw new Error(result.error?.detail || m.ideate_voice_save_failed());
			let profile = result.data;
			if (isDefault && !profile.is_default) {
				const updated = await client.POST('/voice-profiles/{id}/default', {
					params: { path: { id: profile.id } },
					body: { workspace_id: workspace, expected_revision: profile.revision }
				});
				if (
					!settleQueryMutationSession(session, updated.response) ||
					workspace !== workspaceCtx.currentWorkspace?.id
				)
					return;
				if (updated.error || !updated.data)
					throw new Error(updated.error?.detail || m.ideate_voice_save_failed());
				profile = updated.data;
			}
			await queryClient.invalidateQueries({ queryKey: voiceProfileQueryKeys.list(workspace) });
			edit(profile);
			saved = true;
		} catch (cause) {
			if (workspace === workspaceId)
				error = cause instanceof Error ? cause.message : m.ideate_voice_save_failed();
		} finally {
			if (workspace === workspaceId) busy = false;
		}
	}
	async function assign(accountId: string, profileId: string) {
		if (!canEdit || busy) return;
		const workspace = workspaceId;
		const session = captureQueryMutationSession();
		busy = true;
		error = '';
		try {
			const result = await client.PUT('/voice-profile-assignments/{account_id}', {
				params: { path: { account_id: accountId } },
				body: { workspace_id: workspace, voice_profile_id: profileId }
			});
			if (
				!settleQueryMutationSession(session, result.response) ||
				workspace !== workspaceCtx.currentWorkspace?.id
			)
				return;
			if (result.error) throw new Error(result.error.detail || m.ideate_voice_save_failed());
			await queryClient.invalidateQueries({ queryKey: voiceProfileQueryKeys.list(workspace) });
			const current = profiles.data?.find((profile) => profile.id === selected?.id);
			if (current && selected)
				selected = {
					...selected,
					revision: current.revision,
					assigned_account_ids: current.assigned_account_ids
				};
		} catch (cause) {
			if (workspace === workspaceId)
				error = cause instanceof Error ? cause.message : m.ideate_voice_save_failed();
		} finally {
			if (workspace === workspaceId) busy = false;
		}
	}
	$effect(() => {
		if (workspaceId !== initializedWorkspace) {
			initializedWorkspace = '';
			untrack(() => edit());
		}
	});
	$effect(() => {
		const workspace = workspaceId;
		const data = profiles.data;
		if (data && initializedWorkspace !== workspace) {
			initializedWorkspace = workspace;
			untrack(() => edit(data.find((profile) => profile.is_default)));
		}
	});
</script>

<div class="grid max-w-4xl gap-6">
	<p class="text-sm text-muted-foreground">{m.ideate_voice_description()}</p>
	{#if profiles.error}<InlineNotice tone="error" message={m.ideate_voice_load_failed()} />{/if}
	{#if error}<InlineNotice tone="error" message={error} />{/if}
	<div class="flex flex-wrap gap-2">
		<AppSelect
			value={selected?.id ?? ''}
			options={[
				{ value: '', label: m.ideate_new_voice() },
				...(profiles.data ?? []).map((profile) => ({ value: profile.id, label: profile.name }))
			]}
			onValueChange={(id) => edit(profiles.data?.find((profile) => profile.id === id))}
			ariaLabel={m.ideate_voice_profile()}
			class="min-h-11 w-full sm:w-72"
			disabled={busy}
		/>
	</div>
	<form
		class="grid gap-4 sm:grid-cols-2"
		onsubmit={(event) => {
			event.preventDefault();
			void save();
		}}
	>
		<label class="grid gap-1.5 text-sm font-medium"
			>{m.ideate_voice_name()}<Input
				bind:value={name}
				maxlength={80}
				required
				disabled={!canEdit || busy}
			/></label
		>
		<label class="grid gap-1.5 text-sm font-medium"
			>{m.ideate_voice_language()}<Input
				bind:value={language}
				placeholder={m.ideate_voice_language_auto()}
				disabled={!canEdit || busy}
			/></label
		>
		<label class="grid gap-1.5 text-sm font-medium sm:col-span-2"
			>{m.ideate_voice_identity()}<Textarea
				bind:value={identity}
				rows={2}
				disabled={!canEdit || busy}
			/></label
		>
		<label class="grid gap-1.5 text-sm font-medium sm:col-span-2"
			>{m.ideate_voice_guidance()}<Textarea
				bind:value={guidance}
				rows={3}
				placeholder={m.ideate_voice_guidance_placeholder()}
				disabled={!canEdit || busy}
			/></label
		>
		<label class="grid gap-1.5 text-sm font-medium"
			>{m.ideate_voice_humor()}<Input bind:value={humor} disabled={!canEdit || busy} /></label
		>
		<label class="grid gap-1.5 text-sm font-medium"
			>{m.ideate_voice_formality()}<Input
				bind:value={formality}
				disabled={!canEdit || busy}
			/></label
		>
		<label class="grid gap-1.5 text-sm font-medium"
			>{m.ideate_voice_words()}<Textarea
				bind:value={vocabulary}
				rows={3}
				disabled={!canEdit || busy}
			/></label
		>
		<label class="grid gap-1.5 text-sm font-medium"
			>{m.ideate_voice_avoid()}<Textarea
				bind:value={avoidances}
				rows={3}
				disabled={!canEdit || busy}
			/></label
		>
		<div class="grid gap-3 sm:col-span-2">
			<p class="text-sm font-medium">{m.ideate_voice_examples()}</p>
			{#each examples as text, i (i)}<label class="grid gap-1.5 text-xs font-medium"
					>{m.ideate_voice_example_number({ number: i + 1 })}<Textarea
						value={text}
						rows={4}
						oninput={(event) =>
							(examples = examples.map((value, index) =>
								index === i ? event.currentTarget.value : value
							))}
						disabled={!canEdit || busy}
					/></label
				>{/each}<Button
				type="button"
				variant="outline"
				class="w-fit"
				disabled={!canEdit || busy || examples.length >= 12}
				onclick={() => (examples = [...examples, ''])}>{m.ideate_voice_add_example()}</Button
			>
		</div>
		<label class="flex min-h-11 items-center gap-2 text-sm sm:col-span-2"
			><Checkbox
				checked={isDefault}
				onCheckedChange={(checked) => (isDefault = checked === true)}
				disabled={!canEdit || busy || !!selected?.is_default}
			/>{m.ideate_voice_default()}</label
		>
		<div class="flex flex-wrap items-center gap-3 sm:col-span-2">
			<Button type="submit" disabled={!canEdit || busy || !name.trim()} aria-busy={busy}
				>{m.common_save()}</Button
			>{#if saved}<p class="text-sm text-muted-foreground" role="status">
					{m.ideate_voice_saved()}
				</p>{/if}
		</div>
	</form>
	<section class="grid gap-3 border-t pt-5">
		<h2 class="text-sm font-medium">{m.ideate_voice_accounts()}</h2>
		{#each accounts.data ?? [] as account (account.id)}{@const assignment = profiles.data?.find(
				(profile) => profile.assigned_account_ids?.includes(account.id)
			)}
			<div class="grid items-center gap-2 sm:grid-cols-2">
				<p class="text-sm">
					{formatSocialAccountLabel(
						account.account_username,
						account.platform,
						account.alias ?? ''
					)}
				</p>
				<AppSelect
					value={assignment?.id ?? ''}
					options={[
						{ value: '', label: m.ideate_voice_inherit() },
						...(profiles.data ?? []).map((profile) => ({ value: profile.id, label: profile.name }))
					]}
					onValueChange={(id) => void assign(account.id, id)}
					ariaLabel={formatSocialAccountLabel(
						account.account_username,
						account.platform,
						account.alias ?? ''
					)}
					disabled={!canEdit || busy}
					class="min-h-11 w-full"
				/>
			</div>{/each}
	</section>
</div>
