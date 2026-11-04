<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { mode } from 'mode-watcher';
	import { appBrandingImage, defaultAppBranding } from '@openpost/query-catalog';
	import { auth } from '$lib/stores/auth';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { workspaceAppBrandingOptions } from '$lib/query/app-branding';
	import { appBranding } from '$lib/app-branding.svelte';
	let { enabled }: { enabled: boolean } = $props();
	const workspaceID = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	const active = $derived(enabled && $auth.isAuthenticated && Boolean(workspaceID));
	const query = createQuery(() => ({
		...workspaceAppBrandingOptions(workspaceID),
		enabled: active
	}));
	let systemDark = $state(false);
	$effect(() => {
		const media = window.matchMedia('(prefers-color-scheme: dark)');
		systemDark = media.matches;
		const changed = () => (systemDark = media.matches);
		media.addEventListener('change', changed);
		return () => media.removeEventListener('change', changed);
	});
	const dark = $derived(mode.current === 'dark' || (!mode.current && systemDark));
	const profile = $derived(
		active ? (query.data?.effective ?? defaultAppBranding) : defaultAppBranding
	);
	$effect(() => appBranding.apply(`${$auth.user?.id ?? ''}:${workspaceID}`, active, profile, dark));
	let failedFavicons = $state<string[]>([]);
	const favicon = $derived(
		[appBrandingImage(profile, dark)?.url, profile.logo?.url, '/assets/brand/icon.svg'].find(
			(url) => url && !failedFavicons.includes(url)
		) ?? '/assets/brand/icon.svg'
	);
	$effect(() => {
		if (favicon === '/assets/brand/icon.svg') return;
		let current = true;
		const image = new Image();
		image.onerror = () => {
			if (current) failedFavicons = [...failedFavicons, favicon];
		};
		image.src = favicon;
		return () => {
			current = false;
			image.onerror = null;
		};
	});
	$effect(() => {
		const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
		if (!link) return;
		link.href = favicon;
		link.type = favicon.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
		return () => {
			link.href = '/assets/brand/icon.svg';
			link.type = 'image/svg+xml';
		};
	});
</script>
