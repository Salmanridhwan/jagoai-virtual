<script lang="ts">
	import * as DropdownMenu from './ui/dropdown-menu';
	import OverflowMenu from './overflow-menu.svelte';

	let { label = 'Post actions', onAction }: { label?: string; onAction: () => void } = $props();
</script>

<OverflowMenu {label}>
	{#snippet items()}
		<DropdownMenu.Item onclick={onAction}>Rename</DropdownMenu.Item>
		<DropdownMenu.Item onclick={onAction}>Delete</DropdownMenu.Item>
	{/snippet}
</OverflowMenu>
