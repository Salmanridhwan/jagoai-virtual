<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Label } from '$lib/components/ui/label';
	import FieldFeedback from '$lib/components/field-feedback.svelte';
	import { m } from '$lib/paraglide/messages';

	export interface FormFieldSlotArgs {
		id: string;
		describedBy: string | undefined;
		invalid: true | undefined;
	}

	interface Props {
		id: string;
		label: string;
		error?: string;
		touched?: boolean;
		required?: boolean;
		description?: string;
		class?: string;
		children: Snippet<[FormFieldSlotArgs]>;
	}

	let {
		id,
		label,
		error = '',
		touched = false,
		required = false,
		description,
		class: className = '',
		children
	}: Props = $props();

	const errorVisible = $derived(Boolean(touched && error));
	const feedbackId = $derived(`${id}-error`);
	const descriptionId = $derived(description ? `${id}-description` : undefined);
	const describedBy = $derived(
		[descriptionId, errorVisible ? feedbackId : undefined].filter(Boolean).join(' ') || undefined
	);
	const invalid = $derived<true | undefined>(errorVisible ? true : undefined);
</script>

<div class="space-y-2 {className}">
	<Label for={id}>
		{label}{#if required}
			<span class="text-destructive" aria-hidden="true">*</span><span class="sr-only">
				{m.interaction_field_required()}</span
			>
		{/if}
	</Label>
	{@render children({ id, describedBy, invalid })}
	{#if description}
		<p id={descriptionId} class="text-xs leading-5 text-muted-foreground">{description}</p>
	{/if}
	<FieldFeedback id={feedbackId} {error} {touched} />
</div>
