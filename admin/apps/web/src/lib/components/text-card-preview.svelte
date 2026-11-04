<script lang="ts">
	import { untrack } from 'svelte';
	import { renderTextCardPreview } from '$lib/text-card-renderer';
	import { m } from '$lib/paraglide/messages';
	import {
		textCardRequestKey,
		type TextCardIdentity,
		type TextCardRequest,
		type TextCardResult
	} from '$lib/text-cards';
	import type { ComposerSettings } from './compose/modes';
	import InlineNotice from './inline-notice.svelte';
	import { Button } from '$lib/components/ui/button';

	let {
		request,
		visible = true,
		showImages = true,
		savedPreview,
		identity = null,
		defaults = {},
		onResult
	}: {
		request: TextCardRequest | null;
		visible?: boolean;
		showImages?: boolean;
		savedPreview?: TextCardResult;
		identity?: TextCardIdentity | null;
		// Catalogue defaults resolved via textCardDefaultsFrom, so a request that
		// omits styling keys the same way the resolved capability renders it.
		defaults?: ComposerSettings;
		onResult?: (result: TextCardResult) => void;
	} = $props();
	let result = $state<TextCardResult>({ key: '', images: [], loading: false, error: '' });
	let retry = $state(0);
	const key = $derived(textCardRequestKey(request, identity, defaults));
	$effect(() => {
		const requestKey = key;
		const saved = savedPreview;
		const input = untrack(() => request);
		void retry;
		const abort = new AbortController();
		function update(next: TextCardResult) {
			if (abort.signal.aborted) return;
			result = next;
			untrack(() => onResult?.(next));
		}
		if (saved && saved.key === requestKey) {
			update(saved);
			return () => abort.abort();
		}
		update({ key: requestKey, images: [], loading: Boolean(input), error: '' });
		const timer = setTimeout(async () => {
			if (!input) return;
			try {
				const images = await renderTextCardPreview(input, abort.signal);
				update({ key: requestKey, images, loading: false, error: '' });
			} catch (cause) {
				update({
					key: requestKey,
					images: [],
					loading: false,
					error: cause instanceof Error ? cause.message : m.text_card_preview_failed()
				});
			}
		}, 350);
		return () => {
			clearTimeout(timer);
			abort.abort();
		};
	});
</script>

{#if visible && request}
	<div class="space-y-2" aria-busy={result.loading}>
		{#if result.loading}
			<p class="text-xs text-muted-foreground" role="status">{m.text_card_preview_loading()}</p>
		{:else if result.error}
			<InlineNotice tone="error" message={result.error}>
				{#snippet actions()}<Button size="sm" variant="outline" onclick={() => retry++}
						>{m.common_retry()}</Button
					>{/snippet}
			</InlineNotice>
		{:else if showImages}
			<div class="flex snap-x gap-3 overflow-x-auto pb-1">
				{#each result.images as image, index (index)}
					<img
						src={image.data_url}
						width={image.width}
						height={image.height}
						alt={m.text_card_preview_alt({ number: index + 1 })}
						class="max-h-96 w-full max-w-80 shrink-0 snap-center rounded-md border object-contain"
					/>
				{/each}
			</div>
		{/if}
	</div>
{/if}
