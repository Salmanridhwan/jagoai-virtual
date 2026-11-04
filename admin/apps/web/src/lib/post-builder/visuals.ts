import { mount, tick, unmount } from 'svelte';
import type { ScreenshotDocument } from '@openpost/query-catalog';
import ScreenshotPreview from '$lib/screenshot-templates/preview.svelte';
import { renderScreenshot, screenshotFilename } from '$lib/screenshot-templates/export';
import { createScreenshotDesign, saveScreenshotExport } from '$lib/screenshot-templates/api';
import { memeInput } from '$lib/screenshot-templates/meme';
import { memeGeneratorAPI, memePreviewDataURL } from '$lib/meme-generator/api';
import { uploadMediaFile, type MediaUploadResult } from '$lib/media-upload-client';
import { workspaceCtx } from '$lib/stores/workspace.svelte';
import { m } from '$lib/paraglide/messages';

export interface PostVisual {
	url: string;
	blob: Blob;
	aspectRatio?: number;
	document: ScreenshotDocument;
}

export async function renderPostVisual(
	workspaceId: string,
	recipe: ScreenshotDocument,
	signal?: AbortSignal
): Promise<PostVisual> {
	if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
	if (recipe.meme) {
		const image = await memeGeneratorAPI.preview(memeInput(workspaceId, recipe.meme, signal));
		const url = memePreviewDataURL(image);
		const blob = await (await fetch(url)).blob();
		return postVisual(blob, recipe, url);
	}
	const target = document.createElement('div');
	target.setAttribute('aria-hidden', 'true');
	target.inert = true;
	target.style.cssText = 'position:fixed;left:-10000px;top:0;pointer-events:none;width:540px';
	document.body.appendChild(target);
	const preview = mount(ScreenshotPreview, {
		target,
		props: { document: recipe }
	});
	try {
		await tick();
		const element = target.firstElementChild;
		if (!(element instanceof HTMLElement)) throw new Error(m.image_editor_export_failed());
		const blob = await renderScreenshot(element, {
			frameHeight: recipe.frame === 'square' ? 540 : recipe.frame === 'portrait' ? 675 : 0
		});
		if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
		return postVisual(blob, recipe);
	} finally {
		await unmount(preview);
		target.remove();
	}
}

async function postVisual(
	blob: Blob,
	document: ScreenshotDocument,
	url?: string
): Promise<PostVisual> {
	const bitmap = await createImageBitmap(blob);
	const aspectRatio = bitmap.width / bitmap.height;
	bitmap.close();
	return { url: url ?? URL.createObjectURL(blob), blob, document, aspectRatio };
}

export function releasePostVisual(visual: PostVisual): void {
	if (visual.url.startsWith('blob:')) URL.revokeObjectURL(visual.url);
}

export async function savePostVisual(
	workspaceId: string,
	visual: PostVisual,
	altText: string,
	signal?: AbortSignal
): Promise<MediaUploadResult> {
	if (workspaceCtx.currentWorkspace?.id !== workspaceId)
		throw new Error(m.templates_workspace_changed());
	const recipe = visual.document;
	const design = await createScreenshotDesign(workspaceId, recipe);
	const media = await uploadMediaFile({
		workspaceId,
		file: new File([visual.blob], screenshotFilename(recipe.title), {
			type: 'image/png'
		}),
		source: 'screenshot_template',
		altText,
		signal
	});
	await saveScreenshotExport(design.id, design.revision, media.id);
	return media;
}

export async function renderOptionMedia(
	workspaceId: string,
	option: import('./client').PublicationPostOption,
	saved = new Map<string, string>(),
	signal?: AbortSignal
) {
	const rendered: Array<{ account_id: string; media_id: string }> = [];
	for (const destination of option.destinations) {
		const recipe = destination.media.document;
		if (!recipe) continue;
		const key = JSON.stringify(recipe);
		let id = saved.get(key);
		if (!id) {
			const visual = await renderPostVisual(workspaceId, recipe, signal);
			try {
				id = (await savePostVisual(workspaceId, visual, destination.media.alt_text ?? '', signal))
					.id;
			} finally {
				releasePostVisual(visual);
			}
			saved.set(key, id);
		}
		rendered.push({ account_id: destination.account_id, media_id: id });
	}
	return rendered;
}
