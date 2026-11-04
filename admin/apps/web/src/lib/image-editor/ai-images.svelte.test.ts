import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageEditorController } from './editor.svelte';
import { defaultTransform, defaultImageAdjustments } from './document';
import { prepareImageAIRequest, applyImageAIResult } from './ai-images';
import type { ImageGenerationRequest, ImageGenerationRun } from '$lib/query/image-generation';

import { mediaQueryKeys } from '@openpost/query-catalog';
import { queryClient } from '$lib/query/client';

afterEach(() => {
	queryClient.clear();
	vi.unstubAllGlobals();
});

function editorFixture() {
	const editor = new ImageEditorController();
	editor.load({
		id: 'project',
		workspace_id: 'workspace',
		created_by_id: 'user',
		revision: 1,
		can_edit: true,
		created_at: '',
		updated_at: '',
		document: {
			schema_version: 1,
			title: 'Image',
			preset_key: 'custom',
			width_px: 100,
			height_px: 100,
			brand_kit_revision: 0,
			export_defaults: { format: 'png', quality: 1, matte_color: '#ffffff' },
			pages: [
				{
					id: 'page',
					name: 'Page',
					background_color: '#ffffff',
					layers: [
						{
							id: 'photo',
							name: 'Photo',
							type: 'image',
							visible: true,
							locked: false,
							opacity: 0.8,
							transform: { ...defaultTransform(60, 40, 10, 15), rotation: 20 },
							image: {
								media_id: 'original',
								adjustments: defaultImageAdjustments(),
								source_width: 600,
								source_height: 400,
								fit: 'cover',
								crop: { x: 0, y: 0, width: 1, height: 1 }
							}
						}
					]
				}
			]
		}
	});
	editor.selectLayer('photo');
	return editor;
}
const settings: Pick<
	ImageGenerationRequest,
	'operation' | 'prompt' | 'model' | 'quality' | 'size' | 'background'
> = {
	operation: 'edit',
	prompt: 'Make the coat blue',
	model: 'gpt-image-2.5-flare',
	quality: 'high',
	size: 'square_hd',
	background: 'auto'
};
function completed(request: ImageGenerationRequest): ImageGenerationRun {
	return {
		...request,
		id: 'run',
		state: 'completed',
		error_message: '',
		result_media_id: 'generated',
		source_media_id: request.source_media_id ?? '',
		target_layer_id: request.target_layer_id ?? '',
		target_fingerprint: request.target_fingerprint ?? '',
		cost_microusd: null,
		billing_state: 'pending',
		created_at: ''
	};
}

describe('AI image review through editor history', () => {
	it('sends the selected pixels as mask transparency and applies fill at page coordinates', async () => {
		queryClient.setQueryData(mediaQueryKeys.storage('workspace'), {
			asset_count: 0,
			direct_upload_supported: true,
			internal_bytes: 0,
			limit_bytes: 0,
			used_bytes: 0
		});
		const nativeFetch = globalThis.fetch;
		const reservations: RequestInit[] = [];
		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
			if (String(input).endsWith('/api/v1/media/upload-session')) {
				if (init) reservations.push(init);
				return Response.json({
					media_id: 'fill-source',
					deduped: true,
					complete_url: '/api/v1/media/upload-session/fill-source/complete',
					upload: {
						method: 'PUT',
						url: '/api/v1/media/upload-session/fill-source/content',
						headers: {},
						expires_at: '2030-01-01T00:00:00Z',
						object_key: 'fill-source.png'
					}
				});
			}
			return nativeFetch(input, init);
		});
		const editor = editorFixture();
		editor.mutate('Empty page', (document) => {
			document.pages[0].layers = [];
		});
		const selected = new Uint8Array(100 * 100);
		for (let y = 20; y < 40; y++) for (let x = 10; x < 30; x++) selected[y * 100 + x] = 1;
		editor.applyPixelSelection(selected, []);
		const request = await prepareImageAIRequest(editor, { ...settings, operation: 'fill' });
		expect(request.source_media_id).toBe('fill-source');
		expect(reservations).toHaveLength(1);
		expect(JSON.parse(String(reservations[0].body))).toMatchObject({
			workspace_id: 'workspace',
			mime_type: 'image/png',
			source: 'image_editor_edit',
			retention_class: 'library'
		});
		const response = await fetch(`data:image/png;base64,${request.mask_png}`);
		const bitmap = await createImageBitmap(await response.blob());
		const canvas = document.createElement('canvas');
		canvas.width = 100;
		canvas.height = 100;
		const context = canvas.getContext('2d')!;
		context.drawImage(bitmap, 0, 0);
		bitmap.close();
		const alpha = context.getImageData(0, 0, 100, 100).data;
		expect(alpha[(25 * 100 + 15) * 4 + 3]).toBe(0);
		expect(alpha[(40 * 100 + 30) * 4 + 3]).toBe(255);
		await applyImageAIResult(editor, completed(request), { id: 'fill', width: 100, height: 100 });
		expect(editor.activePage!.layers).toHaveLength(1);
		expect(editor.activePage!.layers[0]).toMatchObject({
			image: { media_id: 'fill' },
			transform: { x: 0, y: 0, width: 100, height: 100 }
		});
		editor.undo();
		expect(editor.activePage!.layers).toHaveLength(0);
	});
	it('edits the original requested layer after selection changes, preserving placement and one-step undo', async () => {
		const editor = editorFixture();
		const original = structuredClone($state.snapshot(editor.activePage!.layers[0]));
		const request = await prepareImageAIRequest(editor, settings);
		expect(request.source_media_id).toBe('original');
		expect(request.size).toBe('auto');
		editor.selectLayer('');
		await applyImageAIResult(editor, completed(request), {
			id: 'generated',
			width: 1200,
			height: 800
		});
		expect(editor.activePage!.layers).toHaveLength(1);
		expect(editor.activePage!.layers[0]).toMatchObject({
			id: 'photo',
			transform: original.transform,
			opacity: 0.8,
			image: { media_id: 'generated' }
		});
		editor.undo();
		expect(editor.activePage!.layers[0]).toEqual(original);
	});
	it('keeps a changed layer intact and lets the user explicitly add the result separately', async () => {
		const editor = editorFixture();
		const request = await prepareImageAIRequest(editor, settings);
		editor.updateLayer('photo', { opacity: 0.4 });
		await expect(
			applyImageAIResult(editor, completed(request), { id: 'generated', width: 1200, height: 800 })
		).rejects.toThrow();
		expect(editor.activePage!.layers[0].image?.media_id).toBe('original');
		await applyImageAIResult(
			editor,
			completed(request),
			{ id: 'generated', width: 1200, height: 800 },
			true
		);
		expect(editor.activePage!.layers).toHaveLength(2);
		expect(editor.activePage!.layers[0]).toMatchObject({
			opacity: 0.4,
			image: { media_id: 'original' }
		});
		editor.undo();
		expect(editor.activePage!.layers).toHaveLength(1);
	});
	it('rejects locked sources and results from a different workspace or page', async () => {
		const editor = editorFixture();
		const request = await prepareImageAIRequest(editor, settings);
		editor.updateLayer('photo', { locked: true });
		await expect(prepareImageAIRequest(editor, settings)).rejects.toThrow();
		for (const run of [
			{ ...completed(request), workspace_id: 'other' },
			{ ...completed(request), page_id: 'other' }
		]) {
			await expect(
				applyImageAIResult(editor, run, { id: 'generated', width: 100, height: 100 }, true)
			).rejects.toThrow();
		}
		expect(editor.activePage!.layers).toHaveLength(1);
	});
});
