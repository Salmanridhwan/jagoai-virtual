export type ImageEditorAnimationErrorCode =
	| 'file_limit'
	| 'source_limit'
	| 'timing_limit'
	| 'timing_conflict'
	| 'export_limit'
	| 'output_limit'
	| 'loop_conflict'
	| 'no_animation'
	| 'decode_failed'
	| 'encode_failed'
	| 'timeout'
	| 'frame_missing'
	| 'missing_media';

export class ImageEditorAnimationError extends Error {
	constructor(readonly code: ImageEditorAnimationErrorCode) {
		super(code);
		this.name = 'ImageEditorAnimationError';
	}
}
