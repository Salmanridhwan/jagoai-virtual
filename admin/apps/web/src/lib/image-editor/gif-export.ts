import { ImageEditorAnimationError, type ImageEditorAnimationErrorCode } from './animation-error';
import type { ImageEditorDocument, ImageEditorPage } from './types';
import { imageEditorAnimationTimeline, IMAGE_EDITOR_ANIMATION_LIMITS as LIMITS } from './animation';
import { OpenPostFabricAdapter } from './fabric-adapter';
import { imageEditorPageDimensions } from './page-dimensions';
import type { GifEncodeRequest } from './gif-encode.worker';

export async function renderImageEditorGif(
	document: ImageEditorDocument,
	page: ImageEditorPage,
	signal?: AbortSignal
): Promise<Blob> {
	signal?.throwIfAborted();
	const { frames: timeline, repeat } = imageEditorAnimationTimeline(page);
	const { width, height } = imageEditorPageDimensions(document, page);
	if (
		width > LIMITS.maxDimension ||
		height > LIMITS.maxDimension ||
		width * height * timeline.length > LIMITS.maxExportPixels
	)
		throw new ImageEditorAnimationError('export_limit');
	const worker = new Worker(new URL('./gif-encode.worker.ts', import.meta.url), { type: 'module' });
	const canvas = globalThis.document.createElement('canvas');
	const adapter = new OpenPostFabricAdapter({
		canvas,
		document,
		page,
		readOnly: true,
		staticCanvas: true,
		signal,
		onSelection() {},
		onTransform() {},
		onTextChange() {},
		onMissingMedia() {
			throw new ImageEditorAnimationError('missing_media');
		}
	});
	let rejectPending: ((reason: Error) => void) | undefined;
	const abort = () => {
		worker.terminate();
		rejectPending?.(new DOMException('GIF export cancelled.', 'AbortError'));
	};
	signal?.addEventListener('abort', abort, { once: true });
	async function request(
		message: GifEncodeRequest,
		transfer: Transferable[] = []
	): Promise<{ bytes?: Uint8Array<ArrayBuffer> }> {
		signal?.throwIfAborted();
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				finish();
				worker.terminate();
				reject(new ImageEditorAnimationError('timeout'));
			}, 30_000);
			const finish = () => {
				clearTimeout(timeout);
				rejectPending = undefined;
			};
			rejectPending = (reason) => {
				finish();
				reject(reason);
			};
			worker.onmessage = (
				event: MessageEvent<{
					error?: ImageEditorAnimationErrorCode;
					bytes?: Uint8Array<ArrayBuffer>;
				}>
			) => {
				finish();
				if (event.data.error) reject(new ImageEditorAnimationError(event.data.error));
				else resolve(event.data);
			};
			worker.onerror = () => {
				finish();
				reject(new ImageEditorAnimationError('encode_failed'));
			};
			worker.postMessage(message, transfer);
		});
	}
	try {
		await globalThis.document.fonts?.ready;
		signal?.throwIfAborted();
		await adapter.mount();
		for (const frame of timeline) {
			signal?.throwIfAborted();
			await adapter.sync(document, page, { timeMs: frame.timeMs });
			const pixels = canvas.getContext('2d')!.getImageData(0, 0, width, height).data.buffer;
			await request(
				{ type: 'frame', width, height, pixels, durationMs: frame.durationMs, repeat },
				[pixels]
			);
		}
		const { bytes } = await request({ type: 'finish' });
		signal?.throwIfAborted();
		return new Blob([bytes!], { type: 'image/gif' });
	} finally {
		worker.terminate();
		signal?.removeEventListener('abort', abort);
		adapter.dispose();
		canvas.width = canvas.height = 0;
	}
}
