<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import UiColorPicker from '@openpost/ui/components/color-picker';

	let props: ComponentProps<typeof UiColorPicker> = $props();
</script>

<UiColorPicker {...props} />
