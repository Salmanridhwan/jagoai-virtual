<script lang="ts">
	import AsyncActionButton from '$lib/components/async-action-button.svelte';

	interface Props {
		label: string;
		savingLabel?: string;
		saving?: boolean;
		disabled?: boolean;
		type?: 'button' | 'submit';
		onSave?: (event: MouseEvent) => void | Promise<void>;
	}

	let {
		label,
		savingLabel = label,
		saving = false,
		disabled = false,
		type = 'button',
		onSave
	}: Props = $props();
</script>

<footer data-slot="settings-form-footer" class="flex justify-end border-t pt-4">
	<AsyncActionButton
		{type}
		{label}
		pendingLabel={savingLabel}
		icon="save"
		state={saving ? 'pending' : 'idle'}
		disabled={disabled || saving}
		onclick={onSave}
	/>
</footer>
