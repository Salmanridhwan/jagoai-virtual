import { expect, it } from 'vitest';
import type { KeyframeTrack } from '../project/types';
import { interpolateColorTrackToHex } from './color-keyframes';

it('preserves outgoing color holds at interior keys and clamps at the final key', () => {
	const track: KeyframeTrack = {
		frames: [0, 10, 20, 30, 40],
		values: [0x000000, 0xff0000, 0x00ff00, 0x0000ff, 0xffffff],
		easings: ['hold', 'hold', 'hold', 'hold', 'hold']
	};
	for (const [frame, expected] of [
		[-1, '#000000'],
		[20, '#ff0000'],
		[20.5, '#00ff00'],
		[30, '#00ff00'],
		[39, '#0000ff'],
		[40, '#ffffff']
	] as const) {
		expect(interpolateColorTrackToHex(track, frame, '#808080')).toBe(expected);
	}
});

it('interpolates a neutral midpoint in perceptual lightness within a longer color lane', () => {
	expect(
		interpolateColorTrackToHex(
			{
				frames: [0, 10, 20, 30, 40],
				values: [0xff0000, 0x00ff00, 0x000000, 0xffffff, 0x0000ff]
			},
			25,
			'#808080'
		)
	).toBe('#636363');
});
