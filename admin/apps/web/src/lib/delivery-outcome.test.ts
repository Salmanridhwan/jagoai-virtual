import { describe, expect, it } from 'vitest';
import { deliveryOutcomeBucket, deliveryOutcomeSummary } from './delivery-outcome';

const rendition = (state: string | undefined, status = 'scheduled', recovery_action?: string) => ({
	status,
	delivery:
		state === undefined && recovery_action === undefined ? undefined : { state, recovery_action }
});

describe('deliveryOutcomeBucket', () => {
	it.each(['live', 'published', 'success'])('buckets %s as succeeded', (state) => {
		expect(deliveryOutcomeBucket(rendition(state))).toBe('succeeded');
	});

	it.each(['rejected', 'failed'])('buckets %s as failed', (state) => {
		expect(deliveryOutcomeBucket(rendition(state))).toBe('failed');
	});

	it('buckets ambiguous and manual_resolution as manual', () => {
		expect(deliveryOutcomeBucket(rendition('ambiguous'))).toBe('manual');
		expect(deliveryOutcomeBucket(rendition('manual_resolution'))).toBe('manual');
	});

	it('buckets reconcile and manual_resolution recovery actions as manual', () => {
		expect(deliveryOutcomeBucket(rendition('queued', 'scheduled', 'reconcile'))).toBe('manual');
		expect(deliveryOutcomeBucket(rendition('queued', 'scheduled', 'manual_resolution'))).toBe(
			'manual'
		);
	});

	it.each(['queued', 'submitted', 'processing', 'scheduled', undefined])(
		'buckets %s as pending',
		(state) => {
			expect(deliveryOutcomeBucket(rendition(state))).toBe('pending');
		}
	);

	it('falls back to the rendition status when no delivery state is present', () => {
		expect(deliveryOutcomeBucket({ status: 'live' })).toBe('succeeded');
		expect(deliveryOutcomeBucket({ status: 'failed' })).toBe('failed');
	});
});

describe('deliveryOutcomeSummary', () => {
	it('counts every destination in exactly one bucket', () => {
		const summary = deliveryOutcomeSummary([
			rendition('live'),
			rendition('published'),
			rendition('rejected'),
			rendition('ambiguous'),
			rendition('manual_resolution'),
			rendition('queued', 'scheduled', 'reconcile'),
			rendition('queued'),
			rendition('submitted'),
			rendition('processing')
		]);
		expect(summary).toEqual({ succeeded: 2, pending: 3, failed: 1, manual: 3 });
	});
});
