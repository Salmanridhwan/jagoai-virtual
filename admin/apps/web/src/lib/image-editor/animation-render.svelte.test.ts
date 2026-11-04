import { expect, it } from 'vitest';
import { readImageEditorGif } from './gif-client';
import { decodeImageEditorGif } from './gif-source';
import { blankImageEditorDocument, defaultImageAdjustments, defaultTransform } from './document';
import { OpenPostFabricAdapter } from './fabric-adapter';
import { renderImageEditorPage } from './static-renderer';
import { registerLocalImageEditorMedia, releaseLocalImageEditorMedia } from './local-media-url';
import { renderImageEditorLensEffect } from './lens-effects';

function partialGif(transparent = false): ArrayBuffer {
	const bytes = new Uint8Array([
		71,
		73,
		70,
		56,
		57,
		97,
		2,
		0,
		1,
		0,
		129,
		0,
		0,
		0,
		255,
		0,
		255,
		0,
		0,
		0,
		0,
		255,
		0,
		0,
		0,
		33,
		249,
		4,
		transparent ? 9 : 8,
		10,
		0,
		0,
		0,
		44,
		0,
		0,
		0,
		0,
		1,
		0,
		1,
		0,
		0,
		2,
		2,
		76,
		1,
		0,
		33,
		249,
		4,
		transparent ? 9 : 8,
		10,
		0,
		0,
		0,
		44,
		1,
		0,
		0,
		0,
		1,
		0,
		1,
		0,
		0,
		2,
		2,
		84,
		1,
		0,
		59
	]);
	return bytes.buffer;
}

it('initializes and restores the palette background of opaque partial GIF frames', () => {
	// A 2×1 GIF with a green background, a red left patch, then a blue right patch.
	// Each one-pixel patch uses clear/index/end LZW codes and restore-background disposal.
	const bytes = partialGif();
	const gif = decodeImageEditorGif(bytes);
	expect([...new Uint8Array(gif.pixels[0])]).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
	expect([...new Uint8Array(gif.pixels[1])]).toEqual([0, 255, 0, 255, 0, 0, 255, 255]);
});

it('updates transparency hit targets when selecting a different GIF frame', async () => {
	const mediaID = 'local_media_alpha-animation';
	registerLocalImageEditorMedia(mediaID, new Blob([partialGif(true)], { type: 'image/gif' }));
	const doc = blankImageEditorDocument({
		key: 'custom',
		name: 'Hit targets',
		width_px: 64,
		height_px: 64,
		default_format: 'png',
		profiles: []
	});
	doc.pages[0].layers.push({
		id: 'gif',
		name: 'GIF',
		type: 'image',
		visible: true,
		locked: false,
		opacity: 1,
		transform: defaultTransform(64, 32),
		image: {
			media_id: mediaID,
			source_width: 2,
			source_height: 1,
			fit: 'stretch',
			crop: { x: 0, y: 0, width: 1, height: 1 },
			adjustments: defaultImageAdjustments(),
			animation: {
				source_frame_count: 2,
				repeat: 0,
				frames: [
					{ source_index: 0, duration_ms: 100 },
					{ source_index: 1, duration_ms: 100 }
				]
			}
		}
	});
	const canvas = document.createElement('canvas');
	const adapter = new OpenPostFabricAdapter({
		canvas,
		document: doc,
		page: doc.pages[0],
		readOnly: false,
		onSelection() {},
		onTransform() {},
		onTextChange() {}
	});
	try {
		await adapter.mount();
		expect(adapter.layerIDsAtPoint({ x: 8, y: 16 })).toEqual(['gif']);
		expect(adapter.layerIDsAtPoint({ x: 56, y: 16 })).toEqual([]);
		await adapter.sync(doc, doc.pages[0], { timeMs: 100 });
		expect(adapter.layerIDsAtPoint({ x: 8, y: 16 })).toEqual([]);
		expect(adapter.layerIDsAtPoint({ x: 56, y: 16 })).toEqual(['gif']);
	} finally {
		adapter.dispose();
		releaseLocalImageEditorMedia(mediaID);
	}
});

it('decodes, edits and exports GIF frames in authored order with exact timing and source colors', async () => {
	const blob = await (
		await fetch(new URL('../video-editor/media/fixtures/animated-rgb.gif', import.meta.url))
	).blob();
	const source = await readImageEditorGif(blob, true);
	expect(source.animation.frames.map((frame) => frame.duration_ms)).toEqual([100, 100, 100]);
	const mediaID = 'local_media_animation-proof';
	registerLocalImageEditorMedia(mediaID, blob);
	const document = blankImageEditorDocument({
		key: 'custom',
		name: 'GIF',
		width_px: 64,
		height_px: 64,
		default_format: 'png',
		profiles: []
	});
	document.pages[0].background = { type: 'transparent', opacity: 1 };
	document.pages[0].layers.push({
		id: 'gif',
		name: 'Animation',
		type: 'image',
		visible: true,
		locked: false,
		opacity: 1,
		transform: defaultTransform(32, 24, 16, 20),
		image: {
			media_id: mediaID,
			source_width: 16,
			source_height: 12,
			fit: 'stretch',
			crop: { x: 0, y: 0, width: 1, height: 1 },
			adjustments: defaultImageAdjustments(),
			animation: {
				...source.animation,
				repeat: 0,
				frames: [
					{ source_index: 2, duration_ms: 200 },
					{ source_index: 0, duration_ms: 100 }
				]
			}
		}
	});
	const canvas = window.document.createElement('canvas');
	const adapter = new OpenPostFabricAdapter({
		canvas,
		document,
		page: document.pages[0],
		staticCanvas: true,
		readOnly: true,
		onSelection() {},
		onTransform() {},
		onTextChange() {}
	});
	try {
		await adapter.mount();
		expect([...canvas.getContext('2d')!.getImageData(32, 32, 1, 1).data]).toEqual([
			37, 99, 235, 255
		]);
		await adapter.sync(document, document.pages[0], { timeMs: 200 });
		expect([...canvas.getContext('2d')!.getImageData(32, 32, 1, 1).data]).toEqual([
			220, 38, 38, 255
		]);
		document.export_defaults.format = 'gif';
		const exported = await renderImageEditorPage(document, document.pages[0], 0);
		const decoded = decodeImageEditorGif(await exported.blob.arrayBuffer());
		expect(exported.blob.type).toBe('image/gif');
		expect(decoded.animation.repeat).toBe(0);
		expect(decoded.animation.frames.map((frame) => frame.duration_ms)).toEqual([200, 100]);
		const pixel = (index: number, x: number, y: number) => [
			...new Uint8Array(decoded.pixels[index]).slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 4)
		];
		expect(pixel(0, 32, 32)).toEqual([37, 99, 235, 255]);
		expect(pixel(1, 32, 32)).toEqual([220, 38, 38, 255]);
		expect(pixel(1, 0, 0)).toEqual([0, 0, 0, 0]);
		const original = document.pages[0].layers[0];
		document.pages[0].layers.push({
			...original,
			id: 'second-gif',
			transform: defaultTransform(16, 12, 48, 0),
			image: {
				...original.image!,
				animation: {
					source_frame_count: 3,
					repeat: 0,
					frames: [
						{ source_index: 0, duration_ms: 100 },
						{ source_index: 1, duration_ms: 100 }
					]
				}
			}
		});
		const combined = await renderImageEditorPage(document, document.pages[0], 0);
		const loops = decodeImageEditorGif(await combined.blob.arrayBuffer());
		expect(loops.animation.repeat).toBe(0);
		expect(loops.animation.frames.map((frame) => frame.duration_ms)).toEqual([
			100, 100, 100, 100, 100, 100
		]);
		const fourth = new Uint8Array(loops.pixels[3]);
		expect([...fourth.slice((32 * 64 + 32) * 4, (32 * 64 + 32) * 4 + 4)]).toEqual([
			37, 99, 235, 255
		]);
		expect([...fourth.slice((6 * 64 + 56) * 4, (6 * 64 + 56) * 4 + 4)]).toEqual([22, 163, 74, 255]);
	} finally {
		adapter.dispose();
		releaseLocalImageEditorMedia(mediaID);
	}
});

it.each(['flare', 'starburst', 'mist', 'prism', 'bokeh'] as const)(
	'derives %s from highlights while preserving transparent and dim pixels',
	(kind) => {
		const source = document.createElement('canvas');
		source.width = source.height = 128;
		const context = source.getContext('2d')!;
		context.fillStyle = '#202020';
		context.fillRect(0, 0, 112, 128);
		context.fillStyle = '#ffffff';
		context.fillRect(62, 62, 4, 4);
		const effect = { kind, amount: 1, threshold: 0.75, size: 1, angle: 0, blades: 6 };
		const output = renderImageEditorLensEffect(source, 128, 128, effect);
		const result = output.getContext('2d')!.getImageData(0, 0, 128, 128).data;
		const original = context.getImageData(0, 0, 128, 128).data;
		let brighter = 0;
		for (let i = 0; i < result.length; i += 4) {
			if (result[i] > original[i] + 2) brighter++;
			expect(result[i + 3]).toBe(original[i + 3]);
		}
		expect(brighter).toBeGreaterThan(5);
		const none = renderImageEditorLensEffect(source, 128, 128, { ...effect, threshold: 1 });
		expect(none.getContext('2d')!.getImageData(0, 0, 128, 128).data).toEqual(original);
	}
);

it('keeps lens pixels identical across the canvas, cropped preview, and PNG export', async () => {
	const source = document.createElement('canvas');
	source.width = source.height = 128;
	const context = source.getContext('2d')!;
	context.fillStyle = '#202020';
	context.fillRect(0, 0, 128, 128);
	context.fillStyle = '#ffffff';
	context.fillRect(62, 62, 4, 4);
	const blob = await new Promise<Blob>((resolve) =>
		source.toBlob((blob) => resolve(blob!), 'image/png')
	);
	const mediaID = 'local_media_lens-parity';
	registerLocalImageEditorMedia(mediaID, blob);
	const doc = blankImageEditorDocument({
		key: 'custom',
		name: 'Lens',
		width_px: 64,
		height_px: 64,
		default_format: 'png',
		profiles: []
	});
	doc.pages[0].layers.push({
		id: 'photo',
		name: 'Photo',
		type: 'image',
		visible: true,
		locked: false,
		opacity: 1,
		transform: defaultTransform(64, 64),
		image: {
			media_id: mediaID,
			source_width: 128,
			source_height: 128,
			fit: 'stretch',
			crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
			adjustments: defaultImageAdjustments(),
			color_grade_version: 1,
			lens_effect: {
				kind: 'starburst',
				amount: 0.8,
				threshold: 0.7,
				size: 0.8,
				angle: 15,
				blades: 6
			}
		}
	});
	const canvas = document.createElement('canvas');
	const adapter = new OpenPostFabricAdapter({
		canvas,
		document: doc,
		page: doc.pages[0],
		readOnly: false,
		onSelection() {},
		onTransform() {},
		onTextChange() {}
	});
	try {
		await adapter.mount();
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		const exported = await renderImageEditorPage(doc, doc.pages[0], 0);
		const output = await createImageBitmap(exported.blob);
		const check = document.createElement('canvas');
		check.width = check.height = 64;
		check.getContext('2d')!.drawImage(output, 0, 0);
		output.close();
		expect(canvas.getContext('2d')!.getImageData(0, 0, 64, 64).data).toEqual(
			check.getContext('2d')!.getImageData(0, 0, 64, 64).data
		);
	} finally {
		adapter.dispose();
		releaseLocalImageEditorMedia(mediaID);
	}
});
