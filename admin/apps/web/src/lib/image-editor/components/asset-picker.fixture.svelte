<script lang="ts">
	let {
		open = $bindable(false),
		onConfirm
	}: { open?: boolean; onConfirm: (ids: string[]) => void } = $props();
</script>

{#if open}
	<button onclick={() => onConfirm(['local_media_unlisted'])}>Choose unlisted GIF</button>
{/if}
