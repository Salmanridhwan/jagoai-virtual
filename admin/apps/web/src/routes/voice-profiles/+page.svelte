<script lang="ts">
	import PageContainer from '$lib/components/page-container.svelte';
	import VoiceProfiles from '$lib/components/post-builder/voice-profiles.svelte';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { m } from '$lib/paraglide/messages';
</script>

<PageContainer title={m.ideate_voice_profiles()} themeIconRole="edit">
	{#if workspaceCtx.currentWorkspace?.id}<VoiceProfiles
			workspaceId={workspaceCtx.currentWorkspace.id}
		/>{/if}
</PageContainer>
