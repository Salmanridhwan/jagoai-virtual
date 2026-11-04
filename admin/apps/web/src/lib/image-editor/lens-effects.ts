import type { ImageEditorLensEffect } from './types';

const IMAGE_EDITOR_LENS_KINDS = ['flare', 'starburst', 'mist', 'prism', 'bokeh'] as const;
export const DEFAULT_LENS_EFFECT: ImageEditorLensEffect = {
	kind: 'starburst',
	amount: 0.5,
	threshold: 0.75,
	size: 0.3,
	angle: 0,
	blades: 6
};

export function validImageEditorLensEffect(effect: ImageEditorLensEffect): boolean {
	return (
		IMAGE_EDITOR_LENS_KINDS.includes(effect.kind) &&
		[effect.amount, effect.threshold, effect.size].every(
			(value) => Number.isFinite(value) && value >= 0 && value <= 1
		) &&
		Number.isFinite(effect.angle) &&
		effect.angle >= -180 &&
		effect.angle <= 180 &&
		Number.isInteger(effect.blades) &&
		effect.blades >= 3 &&
		effect.blades <= 8
	);
}

/** Fixed-size highlight analysis keeps work bounded and coordinates independent of output scale. */
export function renderImageEditorLensEffect(
	source: CanvasImageSource,
	width: number,
	height: number,
	effect: ImageEditorLensEffect
): HTMLCanvasElement {
	if (!validImageEditorLensEffect(effect)) throw new Error('Invalid lens effect.');
	const output = document.createElement('canvas');
	output.width = width;
	output.height = height;
	const context = output.getContext('2d')!;
	context.drawImage(source, 0, 0, width, height);
	if (effect.amount === 0) return output;
	const analysis = document.createElement('canvas');
	const scale = Math.min(1, 256 / Math.max(width, height));
	analysis.width = Math.max(1, Math.round(width * scale));
	analysis.height = Math.max(1, Math.round(height * scale));
	const scan = analysis.getContext('2d', { willReadFrequently: true })!;
	scan.drawImage(source, 0, 0, analysis.width, analysis.height);
	const pixels = scan.getImageData(0, 0, analysis.width, analysis.height).data;
	const candidates: Array<{ x: number; y: number; light: number; color: string }> = [];
	for (let y = 0; y < analysis.height; y++) {
		for (let x = 0; x < analysis.width; x++) {
			const i = (y * analysis.width + x) * 4;
			const light =
				((pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722) / 255) *
				(pixels[i + 3] / 255);
			if (light <= effect.threshold) continue;
			candidates.push({
				x,
				y,
				light,
				color: `rgb(${pixels[i]} ${pixels[i + 1]} ${pixels[i + 2]})`
			});
		}
	}
	candidates.sort((a, b) => b.light - a.light || a.y - b.y || a.x - b.x);
	const highlights: typeof candidates = [];
	for (const point of candidates) {
		if (highlights.every((other) => Math.hypot(point.x - other.x, point.y - other.y) >= 12))
			highlights.push(point);
		if (highlights.length === 48) break;
	}
	context.save();
	context.globalCompositeOperation = 'source-atop';
	const angle = (effect.angle * Math.PI) / 180;
	const radius = Math.max(1, Math.min(width, height) * (0.015 + effect.size * 0.22));
	for (const point of highlights) {
		const x = ((point.x + 0.5) * width) / analysis.width;
		const y = ((point.y + 0.5) * height) / analysis.height;
		context.save();
		context.translate(x, y);
		context.rotate(angle);
		context.globalAlpha =
			(effect.amount * (point.light - effect.threshold)) / Math.max(0.001, 1 - effect.threshold);
		if (effect.kind === 'flare' || effect.kind === 'starburst') {
			const rays = effect.kind === 'flare' ? 1 : effect.blades;
			for (let ray = 0; ray < rays; ray++) {
				context.save();
				context.rotate((ray * Math.PI) / rays);
				context.scale(effect.kind === 'flare' ? 2 : 1, 0.035);
				const glow = context.createRadialGradient(0, 0, 0, 0, 0, radius);
				glow.addColorStop(0, point.color);
				glow.addColorStop(1, 'transparent');
				context.fillStyle = glow;
				context.fillRect(-radius, -radius, radius * 2, radius * 2);
				context.restore();
			}
		} else if (effect.kind === 'mist') {
			const glow = context.createRadialGradient(0, 0, 0, 0, 0, radius * 2);
			glow.addColorStop(0, point.color);
			glow.addColorStop(1, 'transparent');
			context.fillStyle = glow;
			context.fillRect(-radius * 2, -radius * 2, radius * 4, radius * 4);
		} else if (effect.kind === 'prism') {
			for (const [index, color] of ['#ff4060', '#40ff80', '#6080ff'].entries()) {
				context.fillStyle = color;
				context.beginPath();
				context.arc((index - 1) * radius, radius * 0.4, radius * 0.25, 0, Math.PI * 2);
				context.fill();
			}
		} else {
			context.fillStyle = point.color;
			context.globalAlpha *= 0.4;
			context.beginPath();
			for (let blade = 0; blade < effect.blades; blade++) {
				const a = (blade * Math.PI * 2) / effect.blades;
				const px = Math.cos(a) * radius;
				const py = Math.sin(a) * radius;
				if (blade === 0) context.moveTo(px, py);
				else context.lineTo(px, py);
			}
			context.closePath();
			context.fill();
		}
		context.restore();
	}
	context.restore();
	analysis.width = analysis.height = 0;
	return output;
}
