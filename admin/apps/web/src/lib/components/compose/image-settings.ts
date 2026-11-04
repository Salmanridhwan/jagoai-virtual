import { z } from 'zod';
import { parseComposerSettingOptionalString, type ComposerSettings } from './modes';

const imageTags = z.array(
	z.object({ x: z.number().optional(), y: z.number().optional() }).passthrough()
);

export interface ImageSize {
	width?: number;
	height?: number;
}

/** Preserve authored positions when fitting adds centered padding. */
export function fittedImageSettings(
	settings: ComposerSettings,
	original: ImageSize,
	fitted: ImageSize,
	restore = false
): ComposerSettings {
	const next = { ...settings };
	if (!original.width || !original.height || !fitted.width || !fitted.height) return next;
	const scale = Math.min(1, fitted.width / original.width, fitted.height / original.height);
	const sx = (original.width * scale) / fitted.width;
	const sy = (original.height * scale) / fitted.height;
	const position = (value: number, factor: number) =>
		Math.max(
			0,
			Math.min(1, restore ? (value - (1 - factor) / 2) / factor : (1 - factor) / 2 + value * factor)
		);
	for (const key of ['user_tags', 'product_tags']) {
		const raw = parseComposerSettingOptionalString(settings[key]);
		if (!raw) continue;
		try {
			const parsed = imageTags.safeParse(JSON.parse(raw));
			if (!parsed.success) continue;
			next[key] = JSON.stringify(
				parsed.data.map((tag) => {
					const moved = { ...tag };
					if (tag.x !== undefined) moved.x = position(tag.x, sx);
					if (tag.y !== undefined) moved.y = position(tag.y, sy);
					return moved;
				})
			);
		} catch {
			/* Retain invalid authored settings for correction. */
		}
	}
	const focalPoint = parseComposerSettingOptionalString(settings.focal_point);
	if (focalPoint) {
		const parts = focalPoint.split(',').map(Number);
		if (parts.length === 2 && parts.every(Number.isFinite)) {
			next.focal_point = `${position((parts[0] + 1) / 2, sx) * 2 - 1},${position((parts[1] + 1) / 2, sy) * 2 - 1}`;
		}
	}
	return next;
}
