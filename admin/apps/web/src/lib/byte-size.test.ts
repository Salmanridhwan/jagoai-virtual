import { describe, expect, it } from 'vitest';
import { formatBytes as formatByteSize } from './byte-size';
import { formatSize } from './media-presentation';
import { formatBytes as constraintsBytes } from './video/constraints';
import { formatBytes as recorderBytes } from './video-editor/recorder/record-mime';

const EN = 'en-US';

// Issue #376: thirteen separate byte formatters disagreed on the same input
// (2 GiB read "2.0 GB" in constraints but "2048.0 MB" in the recorder) and one
// returned an English sentence from a formatting helper.
describe('byte-size convergence (issue #376)', () => {
	it('renders the same byte count identically through every formatter', () => {
		for (const bytes of [
			0,
			1,
			512,
			1023,
			1024,
			2048,
			200 * 1024,
			1024 * 1024,
			1_500_000_000,
			2 * 1024 ** 3,
			5 * 1024 ** 3
		]) {
			const expected = formatByteSize(bytes, { locale: EN, base: 'iec' });
			expect(constraintsBytes(bytes, { locale: EN }), `${bytes} via constraints`).toBe(expected);
			expect(recorderBytes(bytes, { locale: EN }), `${bytes} via recorder`).toBe(expected);
			expect(formatSize(bytes, { locale: EN }), `${bytes} via media library`).toBe(expected);
		}
	});

	it('returns unit-formatted values rather than an English sentence', () => {
		expect(constraintsBytes(2 * 1024 ** 3, { locale: EN })).toBe('2 GB');
		expect(formatByteSize(5 * 1024 ** 3, { locale: EN, base: 'iec' })).toBe('5 GB');
		expect(formatSize(5 * 1024 ** 3, { locale: EN })).toBe('5 GB');
	});

	it('returns a semantic result for non-finite input, not copy or garbage', () => {
		expect(formatByteSize(Number.POSITIVE_INFINITY)).toBeUndefined();
		expect(formatByteSize(Number.NaN)).toBeUndefined();
		expect(formatByteSize(Number.POSITIVE_INFINITY, { base: 'si' })).toBeUndefined();
		expect(constraintsBytes(Number.POSITIVE_INFINITY)).toBeUndefined();
		expect(recorderBytes(Number.POSITIVE_INFINITY)).not.toContain('Infinity');
		expect(formatSize(Number.POSITIVE_INFINITY, { locale: EN })).not.toContain('Infinity');
	});

	it('keeps both unit bases explicit instead of one global choice', () => {
		// 1e9 bytes: decimal billing surface reads GB, binary file surface reads MB.
		expect(formatByteSize(1_000_000_000, { locale: EN, base: 'si' })).toBe('1 GB');
		expect(formatByteSize(1_000_000_000, { locale: EN, base: 'iec' })).toBe('953.7 MB');
		expect(formatByteSize(1_000_000, { locale: EN, base: 'si' })).toBe('1 MB');
		expect(formatByteSize(2 * 1024 ** 3, { locale: EN, base: 'si' })).toBe('2.1 GB');
	});

	it('does not inflate small values', () => {
		expect(formatByteSize(1, { locale: EN, base: 'iec' })).toBe('1 B');
		expect(formatByteSize(0, { locale: EN, base: 'iec' })).toBe('0 B');
		expect(formatByteSize(1024, { locale: EN, base: 'iec' })).toBe('1 KB');
		// The music panel used to round every input to MB, so 200 KB read "0 MB".
		expect(formatByteSize(200 * 1024, { locale: EN, base: 'iec' })).toBe('200 KB');
	});

	it('localizes digits', () => {
		expect(formatByteSize(1.5 * 1024 ** 3, { locale: 'fr-FR', base: 'iec' })).toBe('1,5 GB');
	});
});
