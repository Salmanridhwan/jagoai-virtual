<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import UiTelemetryConsent from '@openpost/ui/components/telemetry-consent';

	let props: ComponentProps<typeof UiTelemetryConsent> = $props();
</script>

<UiTelemetryConsent {...props} />
