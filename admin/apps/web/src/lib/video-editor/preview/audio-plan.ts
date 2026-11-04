import type { TimelineItem, TimelineTrack, TimelineTransition } from '../project/types';
import type { AudioEqSettings } from '../audio/types';
import type { MediaPoolEntry } from '../media/pool.svelte';
import { transitionAudioExtentForItem } from '../audio/transition-crossfade';
import { requiresProcessedPreviewAudioForTimeline } from '../audio/preview-processing';
import { resolveAudioOwner } from './audio-owner';

interface PreviewAudioPlanInput {
	items: TimelineItem[];
	tracks: TimelineTrack[];
	transitions: TimelineTransition[];
	itemById: Map<string, TimelineItem>;
	fps: number;
	busAudioEq?: AudioEqSettings | null;
	mediaEntry: (mediaId: string) => MediaPoolEntry | undefined;
}

interface PreviewAudioLayer {
	item: TimelineItem;
	startFrame: number;
	endFrame: number;
}

/** Resolve ownership and source handles when the timeline changes, before frame selection. */
export function planPreviewAudioLayers(input: PreviewAudioPlanInput): PreviewAudioLayer[] {
	const { items, tracks, transitions, itemById, fps, busAudioEq, mediaEntry } = input;
	const layers: PreviewAudioLayer[] = [];
	for (const item of items) {
		if (item.type !== 'video' && item.type !== 'audio') continue;
		const owner = resolveAudioOwner({
			item,
			tracks,
			allItems: items,
			mediaEntry: item.mediaId ? mediaEntry(item.mediaId) : undefined,
			usesSeparateProxyAudio: false,
			usesProcessedAudio: requiresProcessedPreviewAudioForTimeline(item, tracks, busAudioEq)
		});
		if (owner !== 'processed' && !(owner === 'embedded' && item.type === 'audio')) continue;
		const extent = transitionAudioExtentForItem(item, transitions, itemById, fps);
		layers.push({
			item,
			startFrame: item.from - extent.beforeFrames,
			endFrame: item.from + item.durationInFrames + extent.afterFrames
		});
	}
	return layers;
}
