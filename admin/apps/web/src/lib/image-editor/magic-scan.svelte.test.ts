import { expect, it } from 'vitest';
import { ImageEditorMagicScan } from './magic-scan';

it('rejects the pending scan when its editor is disposed', async () => {
	const scanner = new ImageEditorMagicScan();
	const result = scanner.scan({
		width: 1024,
		height: 1024,
		data: new Uint8ClampedArray(1024 * 1024 * 4),
		point: { x: 0, y: 0 },
		tolerance: 0,
		contiguous: true
	});
	scanner.dispose();
	await expect(result).rejects.toMatchObject({ name: 'AbortError' });
}, 3000);

it('returns a complete worker mask without transferring the editor source buffer', async () => {
	const scanner = new ImageEditorMagicScan();
	const data = new Uint8ClampedArray(1024 * 1024 * 4);
	try {
		const mask = await scanner.scan({
			width: 1024,
			height: 1024,
			data,
			point: { x: 0, y: 0 },
			tolerance: 0,
			contiguous: true
		});
		expect(mask.length).toBe(1024 * 1024);
		expect(mask.every((value) => value === 1)).toBe(true);
		expect(data.byteLength).toBe(1024 * 1024 * 4);
	} finally {
		scanner.dispose();
	}
});

it('rejects cancellation from worker progress even if completion is already queued', async () => {
	const scanner = new ImageEditorMagicScan();
	try {
		await expect(
			scanner.scan(
				{
					width: 1024,
					height: 1024,
					data: new Uint8ClampedArray(1024 * 1024 * 4),
					point: { x: 0, y: 0 },
					tolerance: 0,
					contiguous: true
				},
				{ onProgress: () => scanner.cancel() }
			)
		).rejects.toMatchObject({ name: 'AbortError' });
	} finally {
		scanner.dispose();
	}
});
