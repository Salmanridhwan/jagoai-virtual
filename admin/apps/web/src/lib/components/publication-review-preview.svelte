<script lang="ts">
	import type { components } from '$lib/api/types';
	import type { SocialAccount } from '$lib/api/client';
	import { buildComposerPreview } from '$lib/compose-preview';
	import type { ComposerSettings, ComposerSettingValue } from './compose/modes';
	import ComposerPreview from './composer-preview.svelte';
	import { getPlatformName } from '$lib/utils';
	import { getLocaleTag } from '$lib/i18n';
	import { m } from '$lib/paraglide/messages';
	import { z } from 'zod';
	import { createQuery } from '@tanstack/svelte-query';
	import { capabilityCatalogQueryOptions } from '@openpost/query-catalog';
	import { queryAPI } from '$lib/query/api';
	import { settingLabel } from '$lib/setting-label';
	let {
		publication,
		accounts
	}: { publication: components['schemas']['PublicationResponse']; accounts: SocialAccount[] } =
		$props();

	const scalarSchema = z.union([z.string(), z.number(), z.boolean()]);
	const jsonSchema = z.json();
	const catalog = createQuery(() => capabilityCatalogQueryOptions(queryAPI));
	function settingRows(
		rendition: components['schemas']['RenditionResponse'],
		values: components['schemas']['RenditionResponse']['settings']
	) {
		const definitions =
			catalog.data?.capabilities?.find(
				(item) =>
					item.provider === rendition.platform && item.output_profile === rendition.output_profile
			)?.settings ?? [];
		return Object.entries(values).flatMap(([key, value]) => {
			const parsed = jsonSchema.safeParse(value);
			if (!parsed.success || parsed.data == null || parsed.data === '') return [];
			const scalar = scalarSchema.safeParse(parsed.data);
			const definition = definitions.find((item) => item.key === key);
			return [
				{
					key,
					label: definition
						? settingLabel(definition)
						: key === 'first_comment'
							? m.publishing_setting_first_comment()
							: key.replaceAll('_', ' '),
					value:
						value === true
							? m.compose_setting_yes()
							: value === false
								? m.compose_setting_no()
								: scalar.success
									? String(scalar.data)
									: JSON.stringify(parsed.data, null, 2)
				}
			];
		});
	}
	const valueSchema = z.union([
		z.null(),
		z.string(),
		z.number(),
		z.boolean(),
		z.array(z.string()),
		z.array(z.number()),
		z.array(z.boolean())
	]);
	function settings(
		value: components['schemas']['RenditionResponse']['settings'] | null | undefined
	): ComposerSettings {
		const entries: Array<[string, ComposerSettingValue]> = [];
		for (const [key, item] of Object.entries(value ?? {})) {
			const parsed = valueSchema.safeParse(item);
			if (parsed.success) entries.push([key, parsed.data]);
		}
		return Object.fromEntries(entries);
	}
	function time(value: string) {
		return new Intl.DateTimeFormat(getLocaleTag(), {
			dateStyle: 'medium',
			timeStyle: 'long'
		}).format(new Date(value));
	}
</script>

<div class="grid min-w-0 gap-5">
	{#each publication.renditions ?? [] as rendition (rendition.id)}
		{@const account = accounts.find((item) => item.id === rendition.social_account_id)}
		<section class="grid min-w-0 gap-2">
			<h3 class="text-sm font-semibold">
				{account?.alias || account?.account_username || rendition.social_account_id} · {getPlatformName(
					rendition.platform
				)}
			</h3>
			<p class="text-xs text-muted-foreground">
				{rendition.schedule_override || publication.scheduled_at
					? time(rendition.schedule_override || publication.scheduled_at!)
					: m.review_timing_later()}
			</p>
			{#if account}
				<ComposerPreview
					model={buildComposerPreview({
						account,
						mode: (rendition.segments?.length ?? 0) > 1 ? 'thread' : 'post',
						outputProfile: rendition.output_profile,
						title: rendition.segments?.[0]?.title?.trim()
							? rendition.segments[0].title
							: rendition.title || publication.title,
						subtitle: rendition.segments?.[0]?.description?.trim()
							? rendition.segments[0].description
							: rendition.description,
						destinationSettings: settings(rendition.settings),
						segments: (rendition.segments ?? []).map((segment) => ({
							id: segment.id,
							text: segment.body,
							url: segment.url,
							settings: settings(segment.settings),
							media: (segment.output_media ?? segment.media ?? []).map((media) => ({
								id: media.id,
								mimeType: media.mime_type,
								altText: media.alt_text,
								aspectRatio: media.height ? media.width / media.height : undefined,
								settings: settings(media.settings ?? {})
							}))
						}))
					})}
				/>
			{:else}
				<p class="whitespace-pre-wrap">{rendition.body}</p>
				<p class="text-sm text-destructive">{m.review_account_missing()}</p>
			{/if}
			{#each rendition.segments?.length ? rendition.segments : [null] as segment, index (segment?.id ?? rendition.id)}
				{@const title = segment?.title?.trim()
					? segment.title
					: rendition.title || publication.title}
				{@const description = segment?.description?.trim()
					? segment.description
					: rendition.description}
				{@const values = { ...rendition.settings, ...segment?.settings }}
				<dl
					class="grid gap-2 text-sm"
					aria-label={(rendition.segments?.length ?? 0) > 1 ? String(index + 1) : undefined}
				>
					{#if title}<div class="grid min-w-0 gap-1">
							<dt class="font-medium">{m.workflows_sample_title()}</dt>
							<dd class="break-words whitespace-pre-wrap">{title}</dd>
						</div>{/if}
					{#if description}<div class="grid min-w-0 gap-1">
							<dt class="font-medium">{m.compose_description()}</dt>
							<dd class="break-words whitespace-pre-wrap">{description}</dd>
						</div>{/if}
					{#each settingRows(rendition, values).filter((row) => row.key !== 'first_comment' || index === 0) as row (row.key)}
						<div class="grid min-w-0 gap-1">
							<dt class="font-medium">{row.label}</dt>
							<dd class="break-words whitespace-pre-wrap">{row.value}</dd>
						</div>
					{/each}
				</dl>
			{/each}
		</section>
	{/each}
</div>
