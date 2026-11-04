<script lang="ts">
	import { Input } from './ui/input';
	import FormField from './form-field.svelte';

	interface Props {
		error?: string;
		touched?: boolean;
		required?: boolean;
		description?: string;
	}

	let { error = '', touched = false, required = false, description }: Props = $props();
</script>

<FormField id="display-name" label="Display name" {error} {touched} {required} {description}>
	{#snippet children({ id, describedBy, invalid })}
		<Input {id} aria-describedby={describedBy} aria-invalid={invalid} value="Ada" />
	{/snippet}
</FormField>
