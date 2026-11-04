import type { KeyframeTrack, TimelineItem } from './types';

function orderScalarTrack(track: KeyframeTrack): KeyframeTrack {
	if (!track.frames.some((frame, index) => index > 0 && frame < track.frames[index - 1])) {
		return track;
	}
	const order = track.frames
		.map((_, index) => index)
		.sort((a, b) => track.frames[a] - track.frames[b]);
	return {
		...track,
		frames: order.map((index) => track.frames[index]),
		values: order.map((index) => track.values[index]),
		...(track.ids && { ids: order.map((index) => track.ids![index]) }),
		...(track.easings && {
			easings: order.map((index) => track.easings![index])
		}),
		...(track.easingConfigs && {
			easingConfigs: order.map((index) => track.easingConfigs![index])
		}),
		...(track.sources && {
			sources: order.map((index) => track.sources![index])
		})
	};
}

/** Canonicalize imported lanes once, keeping each key's authored metadata together. */
export function normalizeItemKeyframeOrder(item: TimelineItem): TimelineItem {
	let changed = false;
	const keyframes =
		item.keyframes &&
		Object.fromEntries(
			Object.entries(item.keyframes).map(([property, track]) => {
				if (!track) return [property, track];
				const ordered = orderScalarTrack(track);
				changed ||= ordered !== track;
				return [property, ordered];
			})
		);
	const vectorKeyframes =
		item.vectorKeyframes &&
		Object.fromEntries(
			Object.entries(item.vectorKeyframes).map(([property, keys]) => {
				if (!keys || !keys.some((key, index) => index > 0 && key.frame < keys[index - 1].frame))
					return [property, keys];
				changed = true;
				return [property, keys.toSorted((left, right) => left.frame - right.frame)];
			})
		);
	return changed ? { ...item, keyframes, vectorKeyframes } : item;
}
