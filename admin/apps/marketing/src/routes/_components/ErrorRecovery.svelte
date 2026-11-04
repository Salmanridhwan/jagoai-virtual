<script lang="ts">
	import '@openpost/ui/recovery.css';
	import { resolve } from '$app/paths';
	import { ArrowLeft } from '@lucide/svelte';
	import { Button } from '@openpost/ui/components/button';
	import { marketingErrorRecovery } from '../_error-recovery';

	interface Props {
		status?: number;
		label?: string;
		title?: string;
		description?: string;
	}
	let {
		status = marketingErrorRecovery.status,
		label = marketingErrorRecovery.label,
		title = marketingErrorRecovery.title,
		description = marketingErrorRecovery.description
	}: Props = $props();
</script>

<section class="op-recovery" aria-labelledby="error-recovery-title">
	<div class="op-recovery-body">
		<div>
			<h1 id="error-recovery-title">{title}</h1>
			<p class="op-recovery-copy">{description}</p>
			<div class="op-recovery-actions">
				<Button href={resolve('/')} size="lg">
					<ArrowLeft data-icon="inline-start" />
					{marketingErrorRecovery.primary.label}
				</Button>
				<a href="/docs" class="op-recovery-link">{marketingErrorRecovery.help.label}</a>
			</div>
		</div>
		<figure class="op-recovery-art">
			<img src={marketingErrorRecovery.illustration} alt="" width="768" height="768" />
			<figcaption class="op-recovery-status">
				{status}<span class="sr-only"> · {label}</span>
			</figcaption>
		</figure>
	</div>
</section>
