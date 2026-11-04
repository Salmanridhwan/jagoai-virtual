<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { jobStatusQueryOptions, inboxQueryKeys } from '@openpost/query-catalog';
	import type { components } from '$lib/api/types';
	import { inboxQueryAPI } from '$lib/query/inbox';
	import { queryClient } from '$lib/query/client';
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import InlineNotice from '$lib/components/inline-notice.svelte';

	let { item }: { item: components['schemas']['EngagementItem'] } = $props();
	const review = $derived(item.subject?.review);
	const job = createQuery(() => ({
		...jobStatusQueryOptions(inboxQueryAPI, item.workspace_id, item.reply_job_id ?? ''),
		refetchInterval: (query) =>
			query.state.data && ['pending', 'processing'].includes(query.state.data.status) ? 4000 : false
	}));
	let settledJob = $state('');
	$effect(() => {
		if (job.data?.status === 'completed' && settledJob !== job.data.id) {
			settledJob = job.data.id;
			void queryClient.invalidateQueries({
				queryKey: inboxQueryKeys.engagementRoot(item.workspace_id)
			});
		}
	});
	function moderation(state: string) {
		if (state === 'PENDING') return m.engagement_review_pending();
		if (state === 'APPROVED') return m.engagement_review_approved();
		if (state === 'REJECTED') return m.engagement_review_rejected();
		return state || m.engagement_review_unknown();
	}
</script>

{#if review}
	<div class="mt-3 grid gap-2 text-sm" data-review-context>
		<p>
			{review.stars == null
				? m.engagement_review_unknown()
				: m.engagement_review_rating({ stars: review.stars })}
		</p>
		{#if review.owner_reply}
			<div class="border-s-2 ps-3">
				<p class="font-medium">{m.engagement_owner_reply()}</p>
				<p class="mt-1 whitespace-pre-wrap" dir="auto">{review.owner_reply.text}</p>
				<p class="mt-1 text-xs text-muted-foreground">
					{m.engagement_review_moderation({ state: moderation(review.owner_reply.state) })}
				</p>
				{#if review.owner_reply.policy_violation}
					<p class="text-xs break-words text-muted-foreground">
						{m.engagement_review_policy({ policy: review.owner_reply.policy_violation })}
					</p>
				{/if}
			</div>
		{/if}
		{#if item.reply_job_id}
			<div class="grid gap-2 text-xs text-muted-foreground">
				<p>
					{m.engagement_reply_operation({
						state: job.data?.status ?? item.reply_operation_state ?? ''
					})}
				</p>
				<p>{m.engagement_review_submission_help()}</p>
				<code class="break-all">{item.reply_job_id}</code>
				{#if job.isError || job.data?.status === 'failed'}
					<InlineNotice
						tone="error"
						message={job.data?.last_error || m.engagement_action_failed()}
					/>
				{/if}
				<Button
					variant="outline"
					size="sm"
					class="w-fit"
					disabled={job.isFetching}
					onclick={() => void job.refetch()}>{m.engagement_check_receipt()}</Button
				>
			</div>
		{/if}
	</div>
{/if}
