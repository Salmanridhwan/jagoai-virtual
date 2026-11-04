import { describe, expect, it } from 'vitest';
import type { VariantPost } from './draft-utils';
import { accountNeedsSegmentCopy } from './segment-overrides';

const noVariants = new Map<string, Record<string, VariantPost>>();

describe('accountNeedsSegmentCopy', () => {
	it('reuses the shared segments for an unchanged destination', () => {
		expect(accountNeedsSegmentCopy('account-a', noVariants, {}, false, {})).toBe(false);
	});

	it('sends a copy when the destination has a variant', () => {
		expect(
			accountNeedsSegmentCopy(
				'account-a',
				new Map([['account-a', { 'post-1': { content: '', mediaIds: [] } }]]),
				{},
				false,
				{}
			)
		).toBe(true);
	});

	it('sends a copy for an AI attachment requirement', () => {
		expect(accountNeedsSegmentCopy('account-a', noVariants, { 'account-a': {} }, false, {})).toBe(
			true
		);
	});

	it('sends a copy for every destination when the post carries a poll', () => {
		expect(accountNeedsSegmentCopy('account-a', noVariants, {}, true, {})).toBe(true);
	});

	it('sends a copy when the destination customizes media settings', () => {
		expect(
			accountNeedsSegmentCopy('account-a', noVariants, {}, false, {
				'media-1': { 'account-a': { alt_text: 'A description' } }
			})
		).toBe(true);
	});
});
