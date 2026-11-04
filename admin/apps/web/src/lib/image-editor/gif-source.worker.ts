import { ImageEditorAnimationError } from './animation-error';
import { decodeImageEditorGif, inspectImageEditorGif } from './gif-source';

self.onmessage = async (event: MessageEvent<{ blob: Blob; decode: boolean }>) => {
	try {
		const bytes = await event.data.blob.arrayBuffer();
		if (event.data.decode) {
			const result = decodeImageEditorGif(bytes);
			self.postMessage({ result }, { transfer: result.pixels });
		} else self.postMessage({ result: inspectImageEditorGif(bytes).info });
	} catch (cause) {
		self.postMessage({
			error: cause instanceof ImageEditorAnimationError ? cause.code : 'decode_failed'
		});
	}
};
