import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { mediaConversionTools } from '@openpost/social-images';
import {
	MEDIA_MAX_BYTES,
	OUTPUT_MAX_BYTES,
	mediaLimitLabel,
	openLocalMedia
} from '../_components/tools/local-media';
import { mediaConversionGuide } from './_media-conversion-guides';

const here = dirname(fileURLToPath(import.meta.url));
const readSource = (relative: string) => readFileSync(join(here, relative), 'utf8');

describe('browser media tool byte limits', () => {
	it('exports the input and output limits as bytes', () => {
		expect(MEDIA_MAX_BYTES).toBe(250 * 1024 * 1024);
		expect(OUTPUT_MAX_BYTES).toBe(500 * 1024 * 1024);
	});

	it('formats limit labels from the byte values without drift', () => {
		expect(mediaLimitLabel(MEDIA_MAX_BYTES)).toBe('250 MB');
		expect(mediaLimitLabel(OUTPUT_MAX_BYTES)).toBe('500 MB');
	});

	it('derives the oversized-input error from the input constant', () => {
		// SAFETY: openLocalMedia reads only size before rejecting oversized input.
		const oversized = { size: MEDIA_MAX_BYTES + 1 } as File;
		let message = '';
		try {
			openLocalMedia(oversized);
		} catch (error) {
			message = error instanceof Error ? error.message : '';
		}
		expect(message.length).toBeGreaterThan(0);
		expect(message).toContain(mediaLimitLabel(MEDIA_MAX_BYTES));
	});

	it('derives every conversion guide notice from the constants', () => {
		expect(mediaConversionTools.length).toBeGreaterThan(0);
		for (const tool of mediaConversionTools) {
			const guide = mediaConversionGuide(tool);
			expect(guide.privacy).toContain(mediaLimitLabel(MEDIA_MAX_BYTES));
			expect(guide.privacy).toContain(mediaLimitLabel(OUTPUT_MAX_BYTES));
		}
	});

	it('states no tool limit as a literal', () => {
		const sources = [
			readSource('../_components/tools/local-media.ts'),
			readSource('../_components/tools/local-media-limits.ts'),
			readSource('../_components/tools/MediaConverter.svelte'),
			readSource('./_media-conversion-guides.ts')
		];
		for (const source of sources) {
			expect(source.includes('250 MB')).toBe(false);
			expect(source.includes('500 MB')).toBe(false);
		}
	});

	it('reads the draft-transfer notice from draftTransferLimits', () => {
		const source = readSource('../_components/tools/DraftNextAction.svelte');
		expect(source.includes('draftTransferLimits')).toBe(true);
		expect(source.includes('100 parts')).toBe(false);
		expect(source.includes('250 MB')).toBe(false);
	});
});
