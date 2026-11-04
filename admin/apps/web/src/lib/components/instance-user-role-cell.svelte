<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { m } from '$lib/paraglide/messages';

	let { isAdmin }: { isAdmin: boolean } = $props();
</script>

<Badge tone={isAdmin ? 'info' : 'neutral'}>
	{isAdmin ? m.settings_instance_user_admin() : m.settings_instance_user_member()}
</Badge>
