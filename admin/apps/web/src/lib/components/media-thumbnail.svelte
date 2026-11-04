<script lang="ts">
	import type { Snippet } from 'svelte';
	import { getAuthenticatedMediaURL } from '$lib/media-url';
	import {
		mediaThumbAlt,
		mediaThumbKind,
		mediaThumbnailURL,
		type MediaThumbItem
	} from '$lib/media-thumbnail';
	import { ProtectedIcon, ThemeIcon } from '$lib/themes/icons';

	let {
		item,
		fallbackAlt = '',
		class: className = '',
		loading = 'lazy',
		still,
		onMissing,
		noStill
	}: {
		item: MediaThumbItem;
		fallbackAlt?: string;
		class?: string;
		loading?: 'lazy' | 'eager';
		/**
		 * Override the still image. Use a larger tier or the original where the
		 * tile is bigger than the item's default thumbnail tier.
		 */
		still?: string | null;
		onMissing?: () => void;
		noStill?: Snippet;
	} = $props();

	const kind = $derived(mediaThumbKind(item.mime_type));
	const thumbnailURL = $derived.by(() => {
		const selected = mediaThumbnailURL(item);
		return selected ? getAuthenticatedMediaURL(selected) : '';
	});
	const stillURL = $derived.by(() => {
		if (kind !== 'image' && kind !== 'video') return '';
		const selected = still || mediaThumbnailURL(item);
		return selected ? getAuthenticatedMediaURL(selected) : '';
	});
	const originalURL = $derived(getAuthenticatedMediaURL(item.url));
	const alt = $derived(mediaThumbAlt(item, fallbackAlt));

	let shownURL = $state('');
	let settled = $state(false);
	let retriedOriginal = $state(false);
	let missing = $state(false);

	$effect(() => {
		// Reset the retry state whenever the still selection changes.
		void stillURL;
		void originalURL;
		shownURL = stillURL;
		retriedOriginal = false;
		missing = false;
		settled = true;
	});

	function handleError(event: Event): void {
		const image = event.currentTarget;
		if (!(image instanceof HTMLImageElement)) return;
		if (shownURL && shownURL !== thumbnailURL && shownURL !== originalURL) {
			// The tier override (e.g. a larger still) is missing; fall back to the
			// item's own thumbnail before the full original.
			shownURL = thumbnailURL || originalURL;
			return;
		}
		if (!retriedOriginal && shownURL && shownURL !== originalURL) {
			retriedOriginal = true;
			shownURL = originalURL;
			return;
		}
		if (!missing) {
			missing = true;
			onMissing?.();
		}
	}
</script>

{#snippet placeholder()}
	<div class="flex {className} items-center justify-center bg-muted/30" role="presentation">
		{#if kind === 'audio'}
			<ProtectedIcon icon="media-audio" class="size-8 text-muted-foreground/50" />
		{:else}
			<ThemeIcon role="image" class="size-8 text-muted-foreground/40" />
		{/if}
	</div>
{/snippet}

{#if !missing && shownURL}
	<img src={shownURL} {alt} class={className} {loading} onerror={handleError} />
{:else if !missing && noStill && settled}
	{@render noStill()}
{:else}
	{@render placeholder()}
{/if}
