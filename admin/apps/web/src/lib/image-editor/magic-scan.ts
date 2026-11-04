import { scanMagicPixels, type MagicPixelScanInput } from './magic-scan-core';

const WORKER_PIXEL_THRESHOLD = 1_048_576;
export const MAXIMUM_MAGIC_SCAN_PIXELS = 32_000_000;

type MagicScanWorkerResponse =
	| { type: 'progress'; id: string; fraction: number }
	| { type: 'complete'; id: string; mask: Uint8Array }
	| { type: 'error'; id: string; name: string; message: string };

export class ImageEditorMagicScan {
	private cancelWorker: (() => void) | null = null;
	private activeID = '';

	async scan(
		input: MagicPixelScanInput,
		options: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {}
	): Promise<Uint8Array> {
		const pixels = input.width * input.height;
		if (pixels > MAXIMUM_MAGIC_SCAN_PIXELS) {
			throw new RangeError(
				`Pixel scan exceeds the ${MAXIMUM_MAGIC_SCAN_PIXELS} pixel safety limit.`
			);
		}
		this.cancel();
		const id = crypto.randomUUID();
		this.activeID = id;
		if (typeof Worker === 'undefined' || pixels < WORKER_PIXEL_THRESHOLD) {
			const cancelled = () => options.signal?.aborted === true || this.activeID !== id;
			try {
				if (cancelled()) throw new DOMException('Pixel scan cancelled.', 'AbortError');
				const mask = await scanMagicPixels(input, {
					shouldCancel: cancelled,
					onProgress: options.onProgress
				});
				if (cancelled()) throw new DOMException('Pixel scan cancelled.', 'AbortError');
				return mask;
			} finally {
				if (this.activeID === id) this.activeID = '';
			}
		}
		const worker = new Worker(new URL('./magic-scan.worker.ts', import.meta.url), {
			type: 'module'
		});
		return new Promise<Uint8Array>((resolve, reject) => {
			let settled = false;
			const abort = () =>
				finish(() => reject(new DOMException('Pixel scan cancelled.', 'AbortError')));
			const finish = (complete: () => void): void => {
				if (settled) return;
				settled = true;
				options.signal?.removeEventListener('abort', abort);
				worker.terminate();
				if (this.activeID === id) {
					this.activeID = '';
					this.cancelWorker = null;
				}
				complete();
			};
			this.cancelWorker = abort;
			options.signal?.addEventListener('abort', abort, { once: true });
			worker.onmessage = (event: MessageEvent<MagicScanWorkerResponse>) => {
				const message = event.data;
				if (settled || message.id !== id) return;
				if (message.type === 'progress') options.onProgress?.(message.fraction);
				if (message.type === 'complete') finish(() => resolve(message.mask));
				if (message.type === 'error') {
					finish(() =>
						reject(
							message.name === 'AbortError'
								? new DOMException(message.message, 'AbortError')
								: new Error(message.message)
						)
					);
				}
			};
			worker.onerror = () => finish(() => reject(new Error('Pixel scan worker failed.')));
			if (options.signal?.aborted) {
				finish(() => reject(new DOMException('Pixel scan cancelled.', 'AbortError')));
				return;
			}
			try {
				const data = input.data.slice();
				worker.postMessage({ type: 'scan', id, ...input, data }, [data.buffer]);
			} catch (error) {
				finish(() => reject(error));
			}
		});
	}

	cancel(): void {
		this.cancelWorker?.();
		this.activeID = '';
	}

	dispose(): void {
		this.cancel();
	}
}
