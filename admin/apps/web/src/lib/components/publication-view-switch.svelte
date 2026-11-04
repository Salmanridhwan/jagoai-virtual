<script lang="ts">
	import { page } from '$app/state';
	import { resolveAppPath } from '$lib/app-path';
	import { publicationView, type PublicationView } from '$lib/stores/publication-view.svelte';
	import { m } from '$lib/paraglide/messages';
	import { ThemeIcon } from '$lib/themes/icons';
	import { Button } from '$lib/components/ui/button';
	let { view }: { view: PublicationView } = $props();
	$effect(() => publicationView.remember(view));
	function viewHref(target: PublicationView) {
		const href =
			target === 'calendar'
				? '/calendar'
				: target === 'grid'
					? publicationView.gridHref
					: publicationView.listHref;
		const workspace = page.url.searchParams.get('workspace_id');
		return resolveAppPath(
			workspace
				? `${href}${href.includes('?') ? '&' : '?'}workspace_id=${encodeURIComponent(workspace)}`
				: href
		);
	}
</script>

<nav
	aria-label={m.publication_view_label()}
	class="inline-flex w-full items-center gap-1 rounded-lg bg-muted p-1 sm:w-auto"
>
	<Button
		href={viewHref('list')}
		variant="ghost"
		size="sm"
		class={`min-h-11 flex-1 gap-1.5 px-2 sm:min-h-9 sm:gap-2 sm:px-4 ${view === 'list' ? 'bg-background text-foreground' : ''}`}
		aria-current={view === 'list' ? 'page' : undefined}
		><ThemeIcon role="publications" class="size-4" />{m.publication_view_list()}</Button
	>
	<Button
		href={viewHref('grid')}
		variant="ghost"
		size="sm"
		class={`min-h-11 flex-1 gap-1.5 px-2 sm:min-h-9 sm:gap-2 sm:px-4 ${view === 'grid' ? 'bg-background text-foreground' : ''}`}
		aria-current={view === 'grid' ? 'page' : undefined}
		><ThemeIcon role="layout" class="size-4" />{m.publication_view_grid()}</Button
	>

	<Button
		href={viewHref('calendar')}
		variant="ghost"
		size="sm"
		class={`min-h-11 flex-1 gap-1.5 px-2 sm:min-h-9 sm:gap-2 sm:px-4 ${view === 'calendar' ? 'bg-background text-foreground' : ''}`}
		aria-current={view === 'calendar' ? 'page' : undefined}
		><ThemeIcon role="calendar" class="size-4" />{m.sidebar_calendar()}</Button
	>
</nav>
