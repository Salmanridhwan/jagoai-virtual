import { ImageEditorAnimationError } from './animation-error';
import type { ImageEditorAnimation, ImageEditorPage } from './types';

export const IMAGE_EDITOR_ANIMATION_LIMITS = {
	maxFrames: 200,
	maxDurationMs: 60_000,
	maxDecodedPixels: 16_000_000,
	maxDimension: 2048,
	maxFileBytes: 20 * 1024 * 1024,
	maxExportPixels: 100_000_000,
	maxOutputBytes: 50 * 1024 * 1024
} as const;

export function validImageEditorAnimation(animation: ImageEditorAnimation): boolean {
	return (
		Number.isInteger(animation.source_frame_count) &&
		animation.source_frame_count >= 1 &&
		animation.source_frame_count <= IMAGE_EDITOR_ANIMATION_LIMITS.maxFrames &&
		Number.isInteger(animation.repeat) &&
		animation.repeat >= -1 &&
		animation.repeat <= 65535 &&
		animation.frames.length > 0 &&
		animation.frames.length <= IMAGE_EDITOR_ANIMATION_LIMITS.maxFrames &&
		animation.frames.every(
			(frame) =>
				Number.isInteger(frame.source_index) &&
				frame.source_index >= 0 &&
				frame.source_index < animation.source_frame_count &&
				Number.isInteger(frame.duration_ms) &&
				frame.duration_ms >= 20 &&
				frame.duration_ms <= 10_000 &&
				frame.duration_ms % 10 === 0
		) &&
		imageEditorAnimationDuration(animation) <= IMAGE_EDITOR_ANIMATION_LIMITS.maxDurationMs
	);
}

export function imageEditorAnimationDuration(animation: ImageEditorAnimation): number {
	return animation.frames.reduce((sum, frame) => sum + frame.duration_ms, 0);
}

export function imageEditorPageAnimations(page: ImageEditorPage): ImageEditorAnimation[] {
	const layers = new Map(page.layers.map((layer) => [layer.id, layer]));
	return page.layers.flatMap((layer) => {
		if (!layer.image?.animation) return [];
		let current: typeof layer | undefined = layer;
		const visited = new Set<string>();
		while (current) {
			if (!current.visible || visited.has(current.id)) return [];
			visited.add(current.id);
			current = current.parent_id ? layers.get(current.parent_id) : undefined;
		}
		return [layer.image.animation];
	});
}

export function imageEditorAnimationFrame(animation: ImageEditorAnimation, timeMs: number): number {
	const duration = imageEditorAnimationDuration(animation);
	const elapsed = Math.max(0, timeMs);
	if (
		animation.repeat >= 0 &&
		(animation.repeat === 0 || elapsed < duration * (animation.repeat + 1))
	)
		timeMs = elapsed % duration;
	else timeMs = Math.min(elapsed, duration - 1);
	for (let index = 0; index < animation.frames.length; index++) {
		timeMs -= animation.frames[index].duration_ms;
		if (timeMs < 0) return index;
	}
	return animation.frames.length - 1;
}

/** Merge actual frame boundaries, preserving timing when multiple GIF layers overlap. */
interface ImageEditorAnimationTimeline {
	frames: Array<{ timeMs: number; durationMs: number }>;
	repeat: number;
}

export function imageEditorAnimationTimeline(page: ImageEditorPage): ImageEditorAnimationTimeline {
	const animations = imageEditorPageAnimations(page);
	if (!animations.length) throw new ImageEditorAnimationError('no_animation');
	const cycles = animations.map(imageEditorAnimationDuration);
	const infinite = animations.filter((animation) => animation.repeat === 0).length;
	if (infinite && infinite !== animations.length)
		throw new ImageEditorAnimationError('loop_conflict');
	let repeat = animations[0].repeat;
	let duration = cycles[0];
	if (
		!animations.every(
			(animation, index) => cycles[index] === cycles[0] && animation.repeat === repeat
		)
	) {
		if (infinite) {
			const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
			duration = cycles.reduce((period, cycle) => (period / gcd(period, cycle)) * cycle);
			repeat = 0;
		} else {
			duration = Math.max(
				...animations.map(
					(animation, index) => cycles[index] * (animation.repeat < 0 ? 1 : animation.repeat + 1)
				)
			);
			repeat = -1;
		}
	}
	if (!Number.isSafeInteger(duration) || duration > IMAGE_EDITOR_ANIMATION_LIMITS.maxDurationMs)
		throw new ImageEditorAnimationError('export_limit');
	const boundaries = new Set([0, duration]);
	for (const animation of animations) {
		const cycle = imageEditorAnimationDuration(animation);
		for (let start = 0; start < duration; start += cycle) {
			if (
				animation.repeat !== 0 &&
				start >= cycle * (animation.repeat < 0 ? 1 : animation.repeat + 1)
			)
				break;
			let time = start;
			for (const frame of animation.frames) {
				time += frame.duration_ms;
				if (time < duration) boundaries.add(time);
			}
		}
	}
	const times = [...boundaries].sort((a, b) => a - b);
	if (times.some((time, index) => index > 0 && time - times[index - 1] < 20))
		throw new ImageEditorAnimationError('timing_conflict');
	if (times.length - 1 > IMAGE_EDITOR_ANIMATION_LIMITS.maxFrames)
		throw new ImageEditorAnimationError('export_limit');
	return {
		repeat,
		frames: times
			.slice(0, -1)
			.map((timeMs, index) => ({ timeMs, durationMs: times[index + 1] - timeMs }))
	};
}
