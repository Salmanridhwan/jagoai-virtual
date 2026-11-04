<script lang="ts">
	import { getOptionalUnsavedChanges } from '$lib/unsaved-changes.svelte';
	import * as Tabs from '$lib/components/ui/tabs';
	import { m } from '$lib/paraglide/messages';
	import PageLoading from '$lib/components/page-loading.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { Button } from '$lib/components/ui/button';
	const unsavedChanges = getOptionalUnsavedChanges();
	let selected = $state('theme');
	function select(value: string) {
		if (value === selected || !unsavedChanges || unsavedChanges.confirmDiscard()) selected = value;
	}
	let Themes = $state<typeof import('./theme-appearance-settings.svelte').default>();
	let Branding = $state<typeof import('../settings/AppBrandingSettings.svelte').default>();
	let failed = $state(false);
	async function load(selection = selected) {
		failed = false;
		try {
			if (selection === 'theme' && !Themes)
				Themes = (await import('./theme-appearance-settings.svelte')).default;
			if (selection === 'branding' && !Branding)
				Branding = (await import('../settings/AppBrandingSettings.svelte')).default;
		} catch {
			failed = true;
		}
	}
	$effect(() => {
		void load(selected);
	});
</script>

<Tabs.Root value={selected} onValueChange={select} class="space-y-6">
	<Tabs.List
		><Tabs.Trigger value="theme">{m.app_branding_theme()}</Tabs.Trigger><Tabs.Trigger
			value="branding">{m.app_branding_title()}</Tabs.Trigger
		></Tabs.List
	>
	{#if failed}<InlineNotice tone="error" message={m.app_branding_load_error()}
			><Button variant="outline" onclick={() => void load()}>{m.common_retry()}</Button
			></InlineNotice
		>{/if}
	<Tabs.Content value="theme"
		>{#if Themes}<Themes />{:else if !failed && selected === 'theme'}<PageLoading
				layout="sections"
				label={m.common_loading()}
			/>{/if}</Tabs.Content
	>
	<Tabs.Content value="branding"
		>{#if Branding}<Branding />{:else if !failed && selected === 'branding'}<PageLoading
				layout="sections"
				label={m.common_loading()}
			/>{/if}</Tabs.Content
	>
</Tabs.Root>
