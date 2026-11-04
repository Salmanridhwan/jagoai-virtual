<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import UiEditorColorMagnifier from '@openpost/ui/components/editor-color-magnifier';

	let props: ComponentProps<typeof UiEditorColorMagnifier> = $props();
</script>

<UiEditorColorMagnifier {...props} />
