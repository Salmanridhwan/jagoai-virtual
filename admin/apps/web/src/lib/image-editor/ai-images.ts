import { renderImageEditorPage } from './static-renderer';
import { cloneImageEditorDocument } from './document';
import type { ImageEditorController } from './editor.svelte';
import type { ImageEditorDocument, ImageEditorLayer, ImageEditorPage } from './types';
import { imageEditorPageDimensions } from './page-dimensions';
import { uploadMediaFile } from '$lib/media-upload-client';
import type { ImageGenerationRequest, ImageGenerationRun } from '$lib/query/image-generation';
import { m } from '$lib/paraglide/messages';
import stableJSON from 'safe-stable-stringify';

export async function imageAITargetFingerprint(
	document: ImageEditorDocument,
	page: ImageEditorPage,
	layer?: ImageEditorLayer
) {
	const { preview_media_id: _preview, latest_export_media_id: _export, ...content } = page;
	const encoded = new TextEncoder().encode(
		stableJSON({ size: imageEditorPageDimensions(document, page), target: layer ?? content })
	);
	const hash = await crypto.subtle.digest('SHA-256', encoded);
	return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function prepareImageAIRequest(
	editor: ImageEditorController,
	settings: Pick<
		ImageGenerationRequest,
		'operation' | 'prompt' | 'model' | 'quality' | 'size' | 'background'
	>
): Promise<ImageGenerationRequest> {
	const document = editor.document;
	const page = editor.activePage;
	if (
		!document ||
		!page ||
		!editor.canEdit ||
		editor.floatingPixelSelection ||
		editor.colorPreviewActive
	)
		throw new Error(m.image_ai_finish_edit());
	const request: ImageGenerationRequest = {
		...settings,
		workspace_id: editor.workspaceID,
		project_id: editor.id,
		page_id: page.id
	};
	if (settings.operation === 'generate') return request;
	request.size = 'auto';
	if (settings.operation === 'edit') {
		const layer = editor.selectedLayers.length === 1 ? editor.selectedLayers[0] : undefined;
		if (!layer?.image || editor.isLayerLocked(layer.id)) throw new Error(m.image_ai_select_layer());
		if (layer.image.animation) throw new Error(m.image_editor_animation_still_only());
		request.source_media_id = layer.image.media_id;
		request.target_layer_id = layer.id;
		request.target_fingerprint = await imageAITargetFingerprint(document, page, layer);
		return request;
	}
	const selection = editor.pixelSelection;
	const dimensions = imageEditorPageDimensions(document, page);
	if (dimensions.width * dimensions.height > 16_000_000) throw new Error(m.image_ai_large_canvas());
	if (
		!selection ||
		!selection.data.some(Boolean) ||
		selection.width !== dimensions.width ||
		selection.height !== dimensions.height
	)
		throw new Error(m.image_ai_select_area());
	const selectedPixels = selection.data.slice();
	request.target_fingerprint = await imageAITargetFingerprint(document, page);
	const snapshot = cloneImageEditorDocument(document);
	snapshot.export_defaults.format = 'png';
	const snapshotPage = snapshot.pages.find((item) => item.id === page.id)!;
	delete snapshotPage.color_grade;
	delete snapshotPage.color_grade_version;
	const rendered = await renderImageEditorPage(snapshot, snapshotPage, 0);
	const mask = globalThis.document.createElement('canvas');
	mask.width = dimensions.width;
	mask.height = dimensions.height;
	const context = mask.getContext('2d');
	if (!context) throw new Error(m.image_ai_failed());
	const pixels = context.createImageData(mask.width, mask.height);
	for (let index = 0; index < selectedPixels.length; index++)
		pixels.data[index * 4 + 3] = selectedPixels[index] ? 0 : 255;
	context.putImageData(pixels, 0, 0);
	request.mask_png = mask.toDataURL('image/png').split(',')[1];
	if (editor.document !== document || editor.activePageID !== page.id)
		throw new Error(m.image_ai_stale());
	const source = await uploadMediaFile({
		workspaceId: request.workspace_id,
		file: new File([rendered.blob], 'fill-source.png', { type: 'image/png' }),
		source: 'image_editor_edit',
		retentionClass: 'library'
	});
	request.source_media_id = source.id;
	return request;
}

export async function applyImageAIResult(
	editor: ImageEditorController,
	run: ImageGenerationRun,
	media: { id: string; width: number; height: number },
	asNewLayer = false
) {
	const document = editor.document;
	const page = editor.activePage;
	if (
		!document ||
		!page ||
		!editor.canEdit ||
		run.project_id !== editor.id ||
		run.workspace_id !== editor.workspaceID ||
		page.id !== run.page_id ||
		editor.floatingPixelSelection ||
		editor.colorPreviewActive
	)
		throw new Error(m.image_ai_stale());
	const layer =
		run.operation === 'edit'
			? page.layers.find((item) => item.id === run.target_layer_id)
			: undefined;
	if (run.operation !== 'generate' && !asNewLayer) {
		if (run.operation === 'edit' && (!layer?.image || editor.isLayerLocked(layer.id)))
			throw new Error(m.image_ai_stale());
		if ((await imageAITargetFingerprint(document, page, layer)) !== run.target_fingerprint)
			throw new Error(m.image_ai_stale());
	}
	// The hash awaits Web Crypto. Recheck the immutable document before committing.
	if (editor.document !== document || editor.activePageID !== page.id)
		throw new Error(m.image_ai_stale());
	if (run.operation === 'edit' && !asNewLayer && layer?.image) {
		editor.runAtomicEdits(m.image_ai_edit(), () =>
			editor.updateLayer(layer.id, {
				image: {
					...layer.image!,
					media_id: media.id,
					animation: undefined,
					source_width: media.width,
					source_height: media.height,
					intrinsic_pending: false
				}
			})
		);
	} else {
		editor.runAtomicEdits(
			run.operation === 'fill' ? m.image_ai_fill() : m.image_ai_generate(),
			() => {
				editor.addImage({
					...media,
					name: run.operation === 'fill' ? m.image_ai_fill() : m.image_ai_result()
				});
				const added = editor.selectedLayers[0];
				if (run.operation === 'fill' && added)
					editor.updateLayer(added.id, {
						transform: { ...added.transform, x: 0, y: 0, width: media.width, height: media.height }
					});
			}
		);
	}
	editor.refreshMediaLibrary();
}
