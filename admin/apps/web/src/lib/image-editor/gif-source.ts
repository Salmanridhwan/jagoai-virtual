import { ImageEditorAnimationError } from './animation-error';
import { parseGIF, decompressFrame, type ParsedGif, type ParsedFrame } from 'gifuct-js';
import { IMAGE_EDITOR_ANIMATION_LIMITS as LIMITS, validImageEditorAnimation } from './animation';
import type { ImageEditorAnimation } from './types';

export interface ImageEditorGifInfo {
	width: number;
	height: number;
	animation: ImageEditorAnimation;
}

type GifFrame = Extract<ParsedGif['frames'][number], { image: unknown }>;

interface ImageEditorGifInspection {
	info: ImageEditorGifInfo;
	parsed: ParsedGif;
	frames: GifFrame[];
}

export function inspectImageEditorGif(bytes: ArrayBuffer): ImageEditorGifInspection {
	if (bytes.byteLength > LIMITS.maxFileBytes) throw new ImageEditorAnimationError('file_limit');
	const signature = new TextDecoder().decode(bytes.slice(0, 6));
	if (!['GIF87a', 'GIF89a'].includes(signature))
		throw new ImageEditorAnimationError('decode_failed');
	const parsed = parseGIF(bytes);
	const { width, height } = parsed.lsd;
	const frames = parsed.frames.filter((frame): frame is GifFrame => 'image' in frame);
	if (
		!width ||
		!height ||
		width > LIMITS.maxDimension ||
		height > LIMITS.maxDimension ||
		!frames.length ||
		frames.length > LIMITS.maxFrames ||
		width * height * frames.length > LIMITS.maxDecodedPixels
	)
		throw new ImageEditorAnimationError('source_limit');
	for (const frame of frames) {
		const rect = frame.image.descriptor;
		if (
			!rect.width ||
			!rect.height ||
			rect.left + rect.width > width ||
			rect.top + rect.height > height
		)
			throw new ImageEditorAnimationError('decode_failed');
	}
	const application = parsed.frames.find(
		(frame) => 'application' in frame && frame.application.id === 'NETSCAPE2.0'
	);
	const loop =
		application && 'application' in application ? application.application.blocks : undefined;
	const repeat = loop && loop.length >= 3 ? loop[1] | (loop[2] << 8) : -1;
	const animation: ImageEditorAnimation = {
		source_frame_count: frames.length,
		repeat,
		frames: frames.map((frame, source_index) => ({
			source_index,
			duration_ms: Math.max(20, (frame.gce?.delay || 10) * 10)
		}))
	};
	if (!validImageEditorAnimation(animation)) throw new ImageEditorAnimationError('timing_limit');
	return { info: { width, height, animation }, parsed, frames };
}

/** Decode composited source frames, honoring both restore-background and restore-previous disposal. */
export function decodeImageEditorGif(
	bytes: ArrayBuffer
): ImageEditorGifInfo & { pixels: ArrayBuffer[] } {
	const { info, parsed, frames } = inspectImageEditorGif(bytes);
	const canvas = new OffscreenCanvas(info.width, info.height);
	const context = canvas.getContext('2d', { willReadFrequently: true })!;
	const patchCanvas = new OffscreenCanvas(info.width, info.height);
	const patchContext = patchCanvas.getContext('2d')!;
	const pixels: ArrayBuffer[] = [];
	const paletteBackground = parsed.gct?.[parsed.lsd.backgroundColorIndex];
	function restoreBackground(
		frame: GifFrame,
		left: number,
		top: number,
		width: number,
		height: number
	) {
		context.clearRect(left, top, width, height);
		if (!frame.gce?.extras.transparentColorGiven && paletteBackground) {
			context.fillStyle = `rgb(${paletteBackground.join(' ')})`;
			context.fillRect(left, top, width, height);
		}
	}
	restoreBackground(frames[0], 0, 0, info.width, info.height);
	let previous: ParsedFrame | undefined;
	let previousEncoded: GifFrame | undefined;
	let restore: ImageData | undefined;
	for (const encoded of frames) {
		if (previous?.disposalType === 2) {
			const rect = previous.dims;
			restoreBackground(previousEncoded!, rect.left, rect.top, rect.width, rect.height);
		} else if (previous?.disposalType === 3 && restore) context.putImageData(restore, 0, 0);
		const frame = decompressFrame(encoded, parsed.gct, true);
		restore =
			frame.disposalType === 3 ? context.getImageData(0, 0, info.width, info.height) : undefined;
		patchCanvas.width = frame.dims.width;
		patchCanvas.height = frame.dims.height;
		patchContext.putImageData(
			new ImageData(new Uint8ClampedArray(frame.patch), frame.dims.width, frame.dims.height),
			0,
			0
		);
		context.drawImage(patchCanvas, frame.dims.left, frame.dims.top);
		pixels.push(context.getImageData(0, 0, info.width, info.height).data.buffer);
		previous = frame;
		previousEncoded = encoded;
	}
	canvas.width = canvas.height = patchCanvas.width = patchCanvas.height = 0;
	return { ...info, pixels };
}
