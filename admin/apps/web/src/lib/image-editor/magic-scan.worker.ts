/// <reference lib="webworker" />

import { scanMagicPixels, type MagicPixelScanInput } from './magic-scan-core';

type ScanRequest = MagicPixelScanInput & { type: 'scan'; id: string };
self.onmessage = (event: MessageEvent<ScanRequest>) => {
	const request = event.data;
	void (async () => {
		try {
			const mask = await scanMagicPixels(request, {
				yieldToEventLoop: false,
				onProgress: (fraction) => self.postMessage({ type: 'progress', id: request.id, fraction })
			});
			self.postMessage({ type: 'complete', id: request.id, mask }, [mask.buffer]);
		} catch (cause) {
			self.postMessage({
				type: 'error',
				id: request.id,
				name: cause instanceof DOMException ? cause.name : 'Error',
				message: cause instanceof Error ? cause.message : 'Pixel scan failed.'
			});
		}
	})();
};

export {};
