import { describe, expect, it } from 'vitest';
import { planLinkedMoveGesture } from './edit-gesture';
import type { TimelineItem, TimelineTrack } from '../project/types';

const tracks: TimelineTrack[] = [
	{
		id: 'upper',
		name: 'Visual 2',
		kind: 'video',
		order: 0,
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false
	},
	{
		id: 'lower',
		name: 'Visual 1',
		kind: 'video',
		order: 1,
		height: 96,
		locked: false,
		visible: true,
		muted: false,
		solo: false
	},
	{
		id: 'audio',
		name: 'Audio',
		kind: 'audio',
		order: 2,
		height: 72,
		locked: false,
		visible: true,
		muted: false,
		solo: false
	}
];

function clip(id: string, type: TimelineItem['type'], trackId = 'upper'): TimelineItem {
	return { id, type, trackId, from: 0, durationInFrames: 30, label: id };
}

describe('visual track moves', () => {
	it.each([
		'background',
		'text',
		'image',
		'video',
		'shape',
		'lottie',
		'composition',
		'subtitle',
		'adjustment',
		'controller'
	] as const)('moves %s on the same visual tracks', (type) => {
		const item = clip('item', type);
		expect(
			planLinkedMoveGesture(item, 20, [item], [item.id], { trackId: 'lower', tracks })
		).toEqual([{ id: 'item', from: 20, trackId: 'lower' }]);
	});
	it('rejects audio, locked and occupied destinations', () => {
		const item = clip('item', 'background');
		const original = [{ id: item.id, from: 0, trackId: 'upper' }];
		expect(planLinkedMoveGesture(item, 0, [item], [item.id], { trackId: 'audio', tracks })).toEqual(
			original
		);
		expect(
			planLinkedMoveGesture(item, 0, [item], [item.id], {
				trackId: 'lower',
				tracks: tracks.map((track) => ({ ...track, locked: track.id === 'lower' }))
			})
		).toEqual(original);
		expect(
			planLinkedMoveGesture(item, 0, [item, clip('occupied', 'video', 'lower')], [item.id], {
				trackId: 'lower',
				tracks
			})
		).toEqual(original);
	});
	it('moves linked audio in time while keeping it on its audio track', () => {
		const item = { ...clip('video', 'video'), linkedGroupId: 'pair' };
		const audio = { ...clip('audio', 'audio', 'audio'), linkedGroupId: 'pair' };
		expect(
			planLinkedMoveGesture(item, 20, [item, audio], [item.id], { trackId: 'lower', tracks })
		).toEqual([
			{ id: 'video', from: 20, trackId: 'lower' },
			{ id: 'audio', from: 20, trackId: 'audio' }
		]);
	});
	it('preserves the spacing of a selection and rejects moves past the last visual track', () => {
		const upper = clip('upper', 'text');
		const lower = clip('lower', 'background', 'lower');
		expect(
			planLinkedMoveGesture(upper, 10, [upper, lower], ['upper', 'lower'], {
				trackId: 'lower',
				tracks
			})
		).toEqual([
			{ id: 'upper', from: 0, trackId: 'upper' },
			{ id: 'lower', from: 0, trackId: 'lower' }
		]);
	});
	it('clamps a linked selection to the nearest boundary across its visual tracks', () => {
		const video = {
			...clip('video', 'video'),
			from: 100,
			durationInFrames: 20,
			linkedGroupId: 'pair'
		};
		const audio = {
			...clip('audio', 'audio', 'audio'),
			from: 100,
			durationInFrames: 20,
			linkedGroupId: 'pair'
		};
		const text = { ...clip('text', 'text', 'lower'), from: 150, durationInFrames: 10 };
		const items = [
			video,
			audio,
			text,
			{ ...clip('upper-left', 'video'), from: 70, durationInFrames: 20 },
			{ ...clip('upper-right', 'video'), from: 140 },
			{ ...clip('lower-left', 'video', 'lower'), from: 120, durationInFrames: 15 },
			{ ...clip('lower-right', 'video', 'lower'), from: 165 },
			{ ...clip('existing-overlap', 'video'), from: 105 },
			{ ...clip('mixing-audio', 'audio', 'audio'), from: 0, durationInFrames: 300 }
		];
		for (const [proposed, expectedDelta] of [
			[200, 5],
			[50, -10]
		] as const) {
			expect(
				planLinkedMoveGesture(video, proposed, items, ['text', 'video'], {
					trackId: 'upper',
					tracks
				})
			).toEqual([
				{ id: 'text', from: 150 + expectedDelta, trackId: 'lower' },
				{ id: 'video', from: 100 + expectedDelta, trackId: 'upper' },
				{ id: 'audio', from: 100 + expectedDelta, trackId: 'audio' }
			]);
		}
		expect(items.slice(0, 3).map(({ from }) => from)).toEqual([100, 100, 150]);
	});
	it('rejects a long occupied destination even when shorter clips start between its boundaries', () => {
		const item = { ...clip('moving', 'video'), from: 400 };
		const items = [
			item,
			{ ...clip('long', 'video', 'lower'), from: 0, durationInFrames: 500 },
			{ ...clip('short', 'video', 'lower'), from: 100, durationInFrames: 10 }
		];
		expect(
			planLinkedMoveGesture(item, 400, items, [item.id], { trackId: 'lower', tracks })
		).toEqual([{ id: 'moving', from: 400, trackId: 'upper' }]);
	});
});
