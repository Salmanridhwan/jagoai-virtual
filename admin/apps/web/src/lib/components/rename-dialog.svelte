<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import FormField from '$lib/components/form-field.svelte';
	import { m } from '$lib/paraglide/messages';
	import { ProtectedIcon } from '$lib/themes/icons';

	interface Props {
		open?: boolean;
		title: string;
		description: string;
		label: string;
		initialValue: string;
		maxLength?: number;
		onConfirm: (value: string) => void | Promise<void>;
	}

	let {
		open = $bindable(false),
		title,
		description,
		label,
		initialValue,
		maxLength = 255,
		onConfirm
	}: Props = $props();

	let value = $state('');
	let pending = $state(false);
	let error = $state('');
	let attempted = $state(false);

	function handleOpenChange(nextOpen: boolean): void {
		open = nextOpen;
		if (nextOpen) {
			value = initialValue;
			error = '';
			attempted = false;
		}
	}

	async function submit(): Promise<void> {
		const nextValue = value.trim();
		if (!nextValue || pending) return;
		attempted = true;
		pending = true;
		error = '';
		try {
			await onConfirm(nextValue);
			open = false;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.common_rename_failed();
		} finally {
			pending = false;
		}
	}
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
	<Dialog.Content aria-busy={pending} showCloseButton={false} class="sm:max-w-md">
		<form
			class="space-y-4"
			onsubmit={(event) => {
				event.preventDefault();
				void submit();
			}}
		>
			<Dialog.Header>
				<Dialog.Title>{title}</Dialog.Title>
				<Dialog.Description>{description}</Dialog.Description>
			</Dialog.Header>
			<FormField id="rename-value" {label} {error} touched={attempted} required>
				{#snippet children({ id, describedBy, invalid })}
					<Input
						{id}
						aria-describedby={describedBy}
						aria-invalid={invalid}
						bind:value
						maxlength={maxLength}
						autocomplete="off"
						required
					/>
				{/snippet}
			</FormField>
			<Dialog.Footer>
				<Button
					type="button"
					variant="outline"
					class="w-full sm:w-auto"
					disabled={pending}
					onclick={() => handleOpenChange(false)}
				>
					{m.common_cancel()}
				</Button>
				<Button
					type="submit"
					class="w-full sm:w-auto"
					disabled={pending || !value.trim() || value.trim() === initialValue.trim()}
				>
					{#if pending}<ProtectedIcon
							icon="loading"
							class="size-4 animate-spin motion-reduce:animate-none"
						/>{/if}
					{m.common_save()}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
