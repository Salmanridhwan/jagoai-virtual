import { ImageEditorAnimationError } from './animation-error';
import { m } from '$lib/paraglide/messages';

export function imageEditorErrorMessage(cause: unknown): string | undefined {
	if (!(cause instanceof ImageEditorAnimationError))
		return cause instanceof Error ? cause.message : undefined;
	switch (cause.code) {
		case 'loop_conflict':
			return m.image_editor_animation_loop_conflict();
		case 'timing_conflict':
			return m.image_editor_animation_timing_conflict();
		case 'file_limit':
		case 'source_limit':
			return m.image_editor_animation_source_limit();
		case 'timing_limit':
			return m.image_editor_animation_limit();
		case 'export_limit':
		case 'output_limit':
			return m.image_editor_animation_export_help();
		case 'missing_media':
		case 'frame_missing':
			return m.image_editor_export_missing_media();
		case 'no_animation':
			return m.image_editor_animation_add_layer();
		case 'encode_failed':
		case 'decode_failed':
		case 'timeout':
			return m.image_editor_animation_failed();
	}
}
