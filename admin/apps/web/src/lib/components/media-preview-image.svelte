<script lang="ts">
	import { getAuthenticatedMediaURL } from '$lib/media-url';

	let {
		mediaId,
		alt,
		thumbnailSize = 'md',
		class: className = '',
		onMissing
	}: {
		mediaId: string;
		alt: string;
		thumbnailSize?: 'sm' | 'md' | 'original';
		class?: string;
		onMissing?: () => void;
	} = $props();
	let originalAttemptedFor = $state('');

	const imageURL = $derived(
		thumbnailSize === 'original'
			? getAuthenticatedMediaURL(`/media/${mediaId}`)
			: getAuthenticatedMediaURL(`/media/${mediaId}/thumb/${thumbnailSize}`)
	);
	const originalURL = $derived(getAuthenticatedMediaURL(`/media/${mediaId}`));

	function useOriginal(event: Event) {
		const image = event.currentTarget;
		if (!(image instanceof HTMLImageElement)) return;
		if (originalAttemptedFor !== mediaId && image.src.includes('/thumb/')) {
			originalAttemptedFor = mediaId;
			image.src = originalURL;
			return;
		}
		onMissing?.();
	}
</script>

<img src={imageURL} {alt} class={className} onerror={useOriginal} />
