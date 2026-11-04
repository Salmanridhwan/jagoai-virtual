import { describe, expect, it } from 'vitest';
import {
	capabilityResolutionIsFresh,
	capabilityResponseApplies,
	hasUsableCapabilities
} from './capability-readiness';

describe('hasUsableCapabilities', () => {
	it('accepts every selected account from the previous resolve', () => {
		expect(
			hasUsableCapabilities(['account-a', 'account-b'], { 'account-a': {}, 'account-b': {} }, '')
		).toBe(true);
	});

	it('rejects a selection that still lacks an answer', () => {
		expect(hasUsableCapabilities(['account-a', 'account-b'], { 'account-a': {} }, '')).toBe(false);
	});

	it('rejects an empty selection', () => {
		expect(hasUsableCapabilities([], {}, '')).toBe(false);
	});

	it('rejects readiness after a failed refresh', () => {
		expect(
			hasUsableCapabilities(['account-a'], { 'account-a': {} }, 'Could not load readiness')
		).toBe(false);
	});
});

describe('capabilityResponseApplies', () => {
	const base = {
		requestSequence: 3,
		currentRequestSequence: 3,
		requestedSnapshot: '{"content":"a"}',
		currentSnapshot: '{"content":"a"}'
	};

	it('applies the newest answer for the current state', () => {
		expect(capabilityResponseApplies(base)).toBe(true);
	});

	it('drops a superseded request', () => {
		expect(capabilityResponseApplies({ ...base, currentRequestSequence: 4 })).toBe(false);
	});

	it('drops an answer for a state the user already changed', () => {
		expect(capabilityResponseApplies({ ...base, currentSnapshot: '{"content":"ab"}' })).toBe(false);
	});
});

describe('capabilityResolutionIsFresh', () => {
	it('accepts an applied answer for the current state', () => {
		expect(capabilityResolutionIsFresh('{"content":"a"}', '{"content":"a"}', '')).toBe(true);
	});

	it('rejects a superseded answer', () => {
		expect(capabilityResolutionIsFresh('{"content":"a"}', '{"content":"ab"}', '')).toBe(false);
	});

	it('rejects a failed refresh', () => {
		expect(capabilityResolutionIsFresh('{"content":"a"}', '{"content":"a"}', 'failed')).toBe(false);
	});
});
