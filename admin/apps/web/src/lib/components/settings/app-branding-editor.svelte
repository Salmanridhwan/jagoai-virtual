<script lang="ts">
	import {
		type AppBrandingProfile,
		type AppBrandingProfileInput,
		type AppBrandingSettings,
		type AppBrandingImageInput
	} from '@openpost/query-catalog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { untrack } from 'svelte';
	import { getOptionalUnsavedChanges } from '$lib/unsaved-changes.svelte';
	import Logo from '$lib/components/Logo.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import SettingsFormFooter from '$lib/components/settings-form-footer.svelte';
	import { m } from '$lib/paraglide/messages';

	type Slot = 'logo' | 'dark_logo' | 'wordmark' | 'dark_wordmark';
	let {
		settings,
		organization,
		onSave
	}: {
		settings: AppBrandingSettings;
		organization: boolean;
		onSave: (
			profile: AppBrandingProfileInput | null,
			allow: boolean,
			expectedRevision: number
		) => Promise<void>;
	} = $props();
	const initialRevision = untrack(() =>
		organization ? settings.organization_revision : settings.workspace_revision
	);
	const initial = untrack(() =>
		organization
			? settings.organization_default
			: (settings.workspace_override ?? settings.organization_default)
	);
	const initialAllow = untrack(() => settings.allow_workspace_override);
	const unsavedChanges = getOptionalUnsavedChanges();
	let name = $state(initial.display_name);
	let allow = $state(initialAllow);
	let slots = $state<Partial<Record<Slot, AppBrandingImageInput>>>({});
	let previews = $state<Partial<Record<Slot, string>>>({});
	for (const slot of ['logo', 'dark_logo', 'wordmark', 'dark_wordmark'] as const) {
		if (initial[slot]) {
			slots[slot] = { id: initial[slot].id };
			previews[slot] = initial[slot].url;
		}
	}
	let busy = $state(false);
	let error = $state('');
	let saved = $state(false);
	let pendingReads = $state(0);
	let generation = 0;
	const versions = { logo: 0, dark_logo: 0, wordmark: 0, dark_wordmark: 0 } satisfies Record<
		Slot,
		number
	>;
	const canEdit = $derived(
		organization
			? settings.can_manage_organization
			: settings.can_manage_workspace && settings.allow_workspace_override
	);
	const preview = $derived.by<AppBrandingProfile>(() => {
		const p: AppBrandingProfile = { display_name: name.trim() || initial.display_name };
		for (const slot of ['logo', 'dark_logo', 'wordmark', 'dark_wordmark'] as const)
			if (previews[slot]) p[slot] = { id: slots[slot]?.id ?? slot, url: previews[slot] };
		return p;
	});
	const profile = $derived<AppBrandingProfileInput>({ display_name: name.trim(), ...slots });
	const dirty = $derived(
		name !== initial.display_name ||
			allow !== initialAllow ||
			(['logo', 'dark_logo', 'wordmark', 'dark_wordmark'] as const).some(
				(slot) =>
					(slots[slot]?.id ?? '') !== (initial[slot]?.id ?? '') ||
					Boolean(slots[slot]?.content_base64)
			)
	);
	$effect(() => {
		unsavedChanges?.set('app-branding', dirty || pendingReads > 0, m.settings_unsaved_changes());
		return () => unsavedChanges?.clear('app-branding');
	});
	function remove(slot: Slot) {
		versions[slot]++;
		delete slots[slot];
		delete previews[slot];
		saved = false;
		if (slot === 'logo') remove('dark_logo');
		if (slot === 'wordmark') remove('dark_wordmark');
	}
	async function upload(slot: Slot, file: File) {
		const version = ++versions[slot];
		const currentGeneration = generation;
		pendingReads++;
		error = '';
		saved = false;
		try {
			if (file.size > 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
				throw new Error(m.app_branding_image_help());
			const data = await new Promise<string>((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => resolve(String(reader.result));
				reader.onerror = () => reject(new Error(m.app_branding_image_error()));
				reader.readAsDataURL(file);
			});
			const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
				const image = new Image();
				image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
				image.onerror = () => reject(new Error(m.app_branding_image_error()));
				image.src = data;
			});
			if (
				dimensions.width > 2048 ||
				dimensions.height > 2048 ||
				((slot === 'logo' || slot === 'dark_logo') && dimensions.width !== dimensions.height)
			)
				throw new Error(m.app_branding_dimensions());
			if (version !== versions[slot] || generation !== currentGeneration) return;
			slots[slot] = { content_base64: data.slice(data.indexOf(',') + 1) };
			previews[slot] = data;
		} catch (cause) {
			if (version === versions[slot] && generation === currentGeneration)
				error = cause instanceof Error ? cause.message : m.app_branding_image_error();
		} finally {
			pendingReads--;
		}
	}
	async function save(reset = false) {
		busy = true;
		error = '';
		saved = false;
		try {
			await onSave(reset ? null : profile, allow, initialRevision);
			saved = true;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.app_branding_save_error();
		} finally {
			busy = false;
		}
	}
	$effect(() => () => {
		generation++;
	});
	const fields = $derived([
		{ slot: 'logo' as const, label: m.app_branding_logo() },
		{ slot: 'dark_logo' as const, label: m.app_branding_dark_logo() },
		{ slot: 'wordmark' as const, label: m.app_branding_wordmark() },
		{ slot: 'dark_wordmark' as const, label: m.app_branding_dark_wordmark() }
	]);
</script>

<div class="space-y-6" data-testid="app-branding-editor">
	{#if error}<InlineNotice tone="error" message={error} />{/if}
	{#if saved}<InlineNotice tone="success" message={m.app_branding_saved()} />{/if}
	{#if !organization && !settings.workspace_override}<InlineNotice
			tone="info"
			message={m.app_branding_inheriting()}
		/>{/if}
	{#if !organization && !settings.allow_workspace_override}<InlineNotice
			tone="info"
			message={m.app_branding_locked()}
		/>{/if}
	<form
		class="space-y-6"
		onsubmit={(event) => {
			event.preventDefault();
			void save();
		}}
	>
		<fieldset disabled={!canEdit || busy} class="min-w-0 space-y-6">
			<div class="max-w-md space-y-2">
				<Label for="app-branding-name">{m.app_branding_display_name()}</Label>
				<Input
					id="app-branding-name"
					bind:value={name}
					maxlength={60}
					required
					aria-describedby="app-branding-name-help"
					oninput={() => (saved = false)}
				/>
				<p id="app-branding-name-help" class="text-sm text-muted-foreground">
					{m.app_branding_name_help()}
				</p>
			</div>
			<div class="space-y-3">
				<p id="app-branding-image-help" class="text-sm text-muted-foreground">
					{m.app_branding_image_help()}
					{m.app_branding_dimensions()}
				</p>
				<div class="grid gap-x-8 gap-y-6 lg:grid-cols-2">
					{#each fields as field (field.slot)}
						{@const disabled =
							(field.slot === 'dark_logo' && !slots.logo) ||
							(field.slot === 'dark_wordmark' && !slots.wordmark)}
						<div class="min-w-0 space-y-2">
							<Label for={`app-branding-${field.slot}`}>{field.label}</Label>
							<Input
								id={`app-branding-${field.slot}`}
								type="file"
								accept="image/png,image/jpeg,image/webp"
								{disabled}
								aria-describedby="app-branding-image-help"
								class="min-h-11"
								onchange={(event) => {
									const file = event.currentTarget.files?.[0];
									event.currentTarget.value = '';
									if (file) void upload(field.slot, file);
								}}
							/>
							{#if previews[field.slot]}
								<div class="flex min-h-14 items-center gap-3">
									<div
										class="flex h-12 w-24 items-center justify-center rounded-md border bg-muted/30 p-1"
									>
										<img
											src={previews[field.slot]}
											alt={field.label}
											class="max-h-full max-w-full object-contain"
										/>
									</div>
									<Button
										variant="ghost"
										size="sm"
										class="min-h-11"
										aria-label={m.app_branding_remove_image({ name: field.label })}
										onclick={() => remove(field.slot)}>{m.app_branding_remove()}</Button
									>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</div>
			{#if organization}
				<div class="flex items-start justify-between gap-6 border-t pt-5">
					<div class="space-y-1">
						<Label for="app-branding-allow">{m.app_branding_allow_overrides()}</Label>
						<p id="app-branding-allow-help" class="max-w-xl text-sm text-muted-foreground">
							{m.app_branding_override_help()}
						</p>
					</div>
					<Checkbox
						id="app-branding-allow"
						class="after:-inset-x-3.5 after:-inset-y-3.5"
						bind:checked={allow}
						aria-describedby="app-branding-allow-help"
					/>
				</div>
			{/if}
		</fieldset>
		<section class="space-y-3" aria-label={m.app_branding_preview()}>
			<h3 class="text-sm font-medium">{m.app_branding_preview()}</h3>
			<div class="grid gap-3 sm:grid-cols-2">
				{#each [false, true] as dark}
					<div
						class="min-w-0 space-y-4 rounded-lg border p-4"
						style:background={dark ? '#251f1c' : '#faf9f7'}
						style:color={dark ? '#f4f2ee' : '#302b28'}
						style:--sidebar-foreground={dark ? '#f4f2ee' : '#302b28'}
					>
						<p class="text-xs">{dark ? m.app_branding_dark() : m.app_branding_light()}</p>
						<Logo branding={preview} {dark} showText width={28} height={28} />
						<div class="flex items-center gap-3">
							<Logo branding={preview} {dark} width={24} height={24} /><span class="text-xs"
								>{m.app_branding_compact()}</span
							>
						</div>
					</div>
				{/each}
			</div>
		</section>
		{#if canEdit}
			<div
				class="flex flex-wrap items-center justify-between gap-3 border-t pt-4 [&_[data-slot=settings-form-footer]]:border-0 [&_[data-slot=settings-form-footer]]:pt-0"
			>
				<Button
					variant="outline"
					disabled={busy || pendingReads > 0}
					onclick={() => void save(true)}
					>{organization ? m.app_branding_reset() : m.app_branding_restore()}</Button
				>
				<SettingsFormFooter
					type="submit"
					label={m.common_save()}
					savingLabel={m.common_saving()}
					saving={busy}
					disabled={!dirty || pendingReads > 0 || !name.trim()}
				/>
			</div>
		{/if}
	</form>
</div>
