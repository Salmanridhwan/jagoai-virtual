import { ImageEditorAnimationError } from './animation-error';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { IMAGE_EDITOR_ANIMATION_LIMITS as LIMITS } from './animation';

export type GifEncodeRequest =
	| {
			type: 'frame';
			pixels: ArrayBuffer;
			width: number;
			height: number;
			durationMs: number;
			repeat: number;
	  }
	| { type: 'finish' };
const encoder = GIFEncoder();
let frameCount = 0;
let totalPixels = 0;
self.onmessage = (event: MessageEvent<GifEncodeRequest>) => {
	try {
		const request = event.data;
		if (request.type === 'finish') {
			encoder.finish();
			const bytes = encoder.bytes();
			self.postMessage({ bytes }, { transfer: [bytes.buffer] });
			return;
		}
		totalPixels += request.width * request.height;
		if (++frameCount > LIMITS.maxFrames || totalPixels > LIMITS.maxExportPixels)
			throw new ImageEditorAnimationError('export_limit');
		const pixels = new Uint8Array(request.pixels);
		const palette = quantize(pixels, 255, { format: 'rgb565' });
		const index = applyPalette(pixels, palette, 'rgb565');
		// Reserve index zero even in opaque frames so disposal clears to transparency.
		for (let i = 0; i < index.length; i++) index[i] = pixels[i * 4 + 3] < 128 ? 0 : index[i] + 1;
		encoder.writeFrame(index, request.width, request.height, {
			palette: [[0, 0, 0], ...palette],
			delay: request.durationMs,
			repeat: request.repeat,
			transparent: true,
			transparentIndex: 0,
			dispose: 2
		});
		if (encoder.bytesView().byteLength > LIMITS.maxOutputBytes)
			throw new ImageEditorAnimationError('output_limit');
		self.postMessage({ ready: true });
	} catch (cause) {
		self.postMessage({
			error: cause instanceof ImageEditorAnimationError ? cause.code : 'encode_failed'
		});
	}
};
