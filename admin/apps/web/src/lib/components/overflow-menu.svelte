<script lang="ts">
	import type { Snippet } from 'svelte';
	import { tick } from 'svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Button } from '$lib/components/ui/button';
	import { ThemeIcon } from '$lib/themes/icons';

	type Props = {
		/** Accessible name for the trigger, e.g. `m.day_posts_actions()`. Always required. */
		label: string;
		/** Menu entries rendered inside `DropdownMenu.Content`. Contents and actions stay with the caller. */
		items: Snippet;
		/** Menu placement. Every adopter aligns to the row end. */
		align?: 'start' | 'center' | 'end';
		/** Extra classes for the menu content, e.g. a fixed width. */
		contentClass?: string;
		/** Return focus to the trigger when the menu closes without handing focus elsewhere. */
		returnFocus?: boolean;
		/** Disable the trigger. */
		disabled?: boolean;
	};

	let {
		label,
		items,
		align = 'end',
		contentClass = '',
		returnFocus = true,
		disabled = false
	}: Props = $props();

	let open = $state(false);
	let trigger: HTMLElement | null = $state(null);

	function handleOpenChange(next: boolean) {
		open = next;
		if (!next && returnFocus) {
			// bits-ui moves focus back to the trigger on close. Keep that contract when
			// the menu closes without a focused target (Escape, outside pointer), but
			// never steal focus an action already placed, e.g. a confirmation dialog.
			void tick().then(() => {
				const active = document.activeElement;
				if (
					(active === null || active === document.body) &&
					trigger &&
					document.contains(trigger)
				) {
					trigger.focus();
				}
			});
		}
	}
</script>

<DropdownMenu.Root {open} onOpenChange={handleOpenChange}>
	<DropdownMenu.Trigger bind:ref={trigger}>
		{#snippet child({ props })}
			<Button {...props} type="button" variant="ghost" size="icon" aria-label={label} {disabled}>
				<ThemeIcon role="more-horizontal" class="size-4" />
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content {align} class={contentClass}>
		{@render items()}
	</DropdownMenu.Content>
</DropdownMenu.Root>
