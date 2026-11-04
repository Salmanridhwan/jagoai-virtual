<script lang="ts" module>
	import type { HTMLAttributes } from 'svelte/elements';
	import type { WithElementRef } from '../../utils.js';

	export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'destructive';

	export const badgeToneClasses: Record<BadgeTone, string> = {
		neutral: 'border-border bg-muted text-foreground',
		info: 'border-info-foreground/20 bg-info text-info-foreground',
		success: 'border-success-foreground/20 bg-success text-success-foreground',
		warning: 'border-warning-foreground/25 bg-warning text-warning-foreground',
		destructive:
			'border-action-destructive-foreground/20 bg-action-destructive text-action-destructive-foreground'
	};

	export type BadgeProps = WithElementRef<HTMLAttributes<HTMLSpanElement>> & {
		tone?: BadgeTone;
	};
</script>

<script lang="ts">
	import { cn } from '../../utils.js';

	let {
		ref = $bindable(null),
		class: className,
		tone = 'neutral',
		children,
		...restProps
	}: BadgeProps = $props();
</script>

<span
	bind:this={ref}
	data-slot="badge"
	data-tone={tone}
	class={cn(
		'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium',
		badgeToneClasses[tone],
		className
	)}
	{...restProps}
>
	{@render children?.()}
</span>
