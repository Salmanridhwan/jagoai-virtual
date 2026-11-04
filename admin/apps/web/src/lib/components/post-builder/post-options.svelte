<script lang="ts">
	import type { SocialAccount } from '$lib/api/client';
	import type { PublicationPostOption } from '$lib/post-builder/client';
	import AppSelect from '$lib/components/app-select.svelte';
	import PostOptionCard from './post-option-card.svelte';
	import { formatSocialAccountLabel } from '$lib/utils';
	import { m } from '$lib/paraglide/messages';
	let {
		options,
		accounts,
		workspaceId,
		sources = [],
		busy = false,
		onUse,
		onChange
	}: {
		options: PublicationPostOption[];
		accounts: SocialAccount[];
		workspaceId: string;
		sources?: NonNullable<import('$lib/post-builder/client').PublicationBuildResult['sources']>;
		busy?: boolean;
		onUse: (option: PublicationPostOption) => void;
		onChange: (option: PublicationPostOption) => void;
	} = $props();
	let accountId = $state('');
	const account = $derived(accounts.find((item) => item.id === accountId) ?? accounts[0]);
</script>

<section
	class="grid min-w-0 gap-4"
	aria-label={options.length === 1 ? m.series_edit_post() : m.ideate_results()}
>
	<div class="flex flex-wrap items-center justify-between gap-3">
		<p class="text-sm text-muted-foreground">
			{options.length === 1 ? m.series_edit_description() : m.ideate_choose_one()}
		</p>
		<AppSelect
			value={account?.id}
			options={accounts.map((item) => ({
				value: item.id,
				label: formatSocialAccountLabel(item.account_username, item.platform, item.alias ?? '')
			}))}
			onValueChange={(value) => (accountId = value)}
			ariaLabel={m.ideate_preview_account()}
			class="min-h-11 w-full sm:w-64"
			disabled={busy}
		/>
	</div>
	<div class="grid min-w-0 items-start gap-4 lg:grid-cols-2">
		{#each options as option (option.id)}<PostOptionCard
				{option}
				{account}
				{workspaceId}
				{sources}
				{busy}
				{onUse}
				{onChange}
			/>{/each}
	</div>
</section>
