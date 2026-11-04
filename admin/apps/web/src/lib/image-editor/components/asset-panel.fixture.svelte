<script lang="ts">
	import { untrack } from 'svelte';
	import { provideImageEditor, type ImageEditorController } from '../editor.svelte';
	import AssetPanel from './asset-panel.svelte';
	let { editor, guestMode = true }: { editor: ImageEditorController; guestMode?: boolean } =
		$props();
	provideImageEditor(untrack(() => editor));
</script>

<div class="h-[800px] w-80 bg-background text-foreground"><AssetPanel {guestMode} /></div>
