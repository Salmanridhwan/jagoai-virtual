import { ImageEditorAnimationError, type ImageEditorAnimationErrorCode } from './animation-error';
import type { ImageEditorGifInfo } from './gif-source';
import { IMAGE_EDITOR_ANIMATION_LIMITS } from './animation';

export function readImageEditorGif(
	blob: Blob,
	decode: true,
	signal?: AbortSignal
): Promise<ImageEditorGifInfo & { pixels: ArrayBuffer[] }>;
export function readImageEditorGif(
	blob: Blob,
	decode: false,
	signal?: AbortSignal
): Promise<ImageEditorGifInfo>;
export function readImageEditorGif(
	blob: Blob,
	decode: boolean,
	signal?: AbortSignal
): Promise<ImageEditorGifInfo & { pixels?: ArrayBuffer[] }> {
	signal?.throwIfAborted();
	if (blob.size > IMAGE_EDITOR_ANIMATION_LIMITS.maxFileBytes)
		return Promise.reject(new ImageEditorAnimationError('file_limit'));
	return new Promise((resolve, reject) => {
		const worker = new Worker(new URL('./gif-source.worker.ts', import.meta.url), {
			type: 'module'
		});
		const cleanup = () => {
			worker.terminate();
			signal?.removeEventListener('abort', abort);
			clearTimeout(timer);
		};
		const abort = () => {
			cleanup();
			reject(signal?.reason ?? new DOMException('GIF cancelled.', 'AbortError'));
		};
		const timer = setTimeout(() => {
			cleanup();
			reject(new ImageEditorAnimationError('timeout'));
		}, 30_000);
		worker.onmessage = (
			event: MessageEvent<{
				error?: ImageEditorAnimationErrorCode;
				result: ImageEditorGifInfo & { pixels?: ArrayBuffer[] };
			}>
		) => {
			cleanup();
			if (event.data.error) reject(new ImageEditorAnimationError(event.data.error));
			else resolve(event.data.result);
		};
		worker.onerror = () => {
			cleanup();
			reject(new ImageEditorAnimationError('decode_failed'));
		};
		signal?.addEventListener('abort', abort, { once: true });
		worker.postMessage({ blob, decode });
	});
}
