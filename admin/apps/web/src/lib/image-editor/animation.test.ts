import { expect, it } from 'vitest';
import { imageEditorAnimationFrame, imageEditorAnimationTimeline } from './animation';
import { blankImageEditorPage, defaultTransform } from './document';
import type { ImageEditorAnimation } from './types';

it('uses authored frame timing, holds one-shot endings, and repeats only the requested cycles', () => {
	const animation: ImageEditorAnimation = {
		source_frame_count: 3,
		repeat: -1,
		frames: [
			{ source_index: 2, duration_ms: 200 },
			{ source_index: 0, duration_ms: 100 }
		]
	};
	expect(
		[0, 199, 200, 299, 300, 1000].map((time) => imageEditorAnimationFrame(animation, time))
	).toEqual([0, 0, 1, 1, 1, 1]);
	animation.repeat = 0;
	expect([300, 499, 500, 600].map((time) => imageEditorAnimationFrame(animation, time))).toEqual([
		0, 0, 1, 0
	]);
	animation.repeat = 1;
	expect([300, 500, 600].map((time) => imageEditorAnimationFrame(animation, time))).toEqual([
		0, 1, 1
	]);
});

it('merges overlapping animation boundaries without flattening variable frame durations', () => {
	const page = blankImageEditorPage();
	page.layers = [
		{
			source_frame_count: 2,
			repeat: -1,
			frames: [
				{ source_index: 0, duration_ms: 100 },
				{ source_index: 1, duration_ms: 100 }
			]
		},
		{
			source_frame_count: 2,
			repeat: -1,
			frames: [
				{ source_index: 0, duration_ms: 150 },
				{ source_index: 1, duration_ms: 150 }
			]
		}
	].map((animation, index) => ({
		id: `layer-${index}`,
		type: 'image',
		visible: true,
		locked: false,
		opacity: 1,
		name: 'GIF',
		transform: defaultTransform(64, 64),
		image: {
			media_id: 'gif',
			source_width: 64,
			source_height: 64,
			fit: 'stretch',
			crop: { x: 0, y: 0, width: 1, height: 1 },
			adjustments: {
				brightness: 0,
				contrast: 0,
				saturation: 0,
				exposure: 0,
				highlights: 0,
				shadows: 0,
				temperature: 0,
				tint: 0,
				vibrance: 0,
				hue: 0,
				blur: 0
			},
			animation
		}
	}));
	expect(imageEditorAnimationTimeline(page).frames).toEqual([
		{ timeMs: 0, durationMs: 100 },
		{ timeMs: 100, durationMs: 50 },
		{ timeMs: 150, durationMs: 50 },
		{ timeMs: 200, durationMs: 100 }
	]);
	page.layers.forEach((layer) => {
		layer.image!.animation!.repeat = 0;
	});
	const looped = imageEditorAnimationTimeline(page);
	expect(looped.repeat).toBe(0);
	expect(looped.frames.reduce((sum, frame) => sum + frame.durationMs, 0)).toBe(600);
	page.layers[1].image!.animation!.repeat = -1;
	expect(() => imageEditorAnimationTimeline(page)).toThrow('loop_conflict');
	page.layers[1].image!.animation!.repeat = 0;
	page.layers[1].image!.animation!.frames = [
		{ source_index: 0, duration_ms: 110 },
		{ source_index: 1, duration_ms: 90 }
	];
	expect(() => imageEditorAnimationTimeline(page)).toThrow('timing_conflict');
});
