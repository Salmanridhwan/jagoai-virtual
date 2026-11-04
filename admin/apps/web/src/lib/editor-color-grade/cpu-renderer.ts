import { buildCurvesLut } from './curves';
import type { EditorColorRenderEffect } from './rendering';

const SUPPORTED_EFFECTS = new Set([
	'gpu-brightness',
	'gpu-exposure',
	'gpu-contrast',
	'gpu-saturation',
	'gpu-vibrance',
	'gpu-hue-shift',
	'gpu-temperature',
	'gpu-color-wheels',
	'gpu-curves'
]);

function numberParam(effect: EditorColorRenderEffect, name: string, fallback: number): number {
	const value = Number(effect.params[name] ?? fallback);
	return Number.isFinite(value) ? value : fallback;
}

/** Exact Canvas2D fallback for the shared grade effects used by still images. */
export function renderColorEffectsWithCanvas2D(
	canvas: HTMLCanvasElement,
	source: TexImageSource,
	width: number,
	height: number,
	effects: readonly EditorColorRenderEffect[]
): boolean {
	if (effects.some((effect) => !SUPPORTED_EFFECTS.has(effect.effectId))) return false;
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) return false;
	try {
		if (source instanceof ImageData) {
			const sourceCanvas = document.createElement('canvas');
			sourceCanvas.width = source.width;
			sourceCanvas.height = source.height;
			const sourceContext = sourceCanvas.getContext('2d');
			if (!sourceContext) return false;
			sourceContext.putImageData(source, 0, 0);
			context.drawImage(sourceCanvas, 0, 0, width, height);
		} else {
			context.drawImage(source, 0, 0, width, height);
		}
		const frame = context.getImageData(0, 0, width, height);
		applyColorEffectsToPixels(frame.data, effects);
		context.putImageData(frame, 0, 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * CPU implementation of the canonical effect parameters.
 *
 * Channels are quantized after each effect, matching the inline GPU color batch.
 */
export function applyColorEffectsToPixels(
	pixels: Uint8ClampedArray,
	effects: readonly EditorColorRenderEffect[]
): void {
	let lookup: Uint8Array | null = null;
	for (const effect of effects) {
		const transform = prepareColorTransform(effect);
		if (!transform) continue;
		if (CHANNEL_EFFECTS.has(effect.effectId)) {
			// Each channel starts as a byte and is quantized after every effect.
			// Compose those exact byte mappings before touching the full image.
			const previous = lookup;
			lookup = new Uint8Array(256 * 4);
			for (let value = 0; value < 256; value++) {
				const index = value * 4;
				const [red, green, blue] = transform(
					(previous ? previous[index] : value) / 255,
					(previous ? previous[index + 1] : value) / 255,
					(previous ? previous[index + 2] : value) / 255
				);
				lookup[index] = quantize(red);
				lookup[index + 1] = quantize(green);
				lookup[index + 2] = quantize(blue);
			}
			continue;
		}
		if (lookup) applyChannelLookup(pixels, lookup);
		lookup = null;
		for (let index = 0; index < pixels.length; index += 4) {
			const [red, green, blue] = transform(
				pixels[index] / 255,
				pixels[index + 1] / 255,
				pixels[index + 2] / 255
			);
			pixels[index] = quantize(red);
			pixels[index + 1] = quantize(green);
			pixels[index + 2] = quantize(blue);
		}
	}
	if (lookup) applyChannelLookup(pixels, lookup);
}

const CHANNEL_EFFECTS = new Set([
	'gpu-brightness',
	'gpu-exposure',
	'gpu-contrast',
	'gpu-temperature',
	'gpu-curves'
]);

type ColorTransform = (
	red: number,
	green: number,
	blue: number
) => readonly [number, number, number];

function applyChannelLookup(pixels: Uint8ClampedArray, lookup: Uint8Array): void {
	for (let index = 0; index < pixels.length; index += 4) {
		pixels[index] = lookup[pixels[index] * 4];
		pixels[index + 1] = lookup[pixels[index + 1] * 4 + 1];
		pixels[index + 2] = lookup[pixels[index + 2] * 4 + 2];
	}
}

function prepareColorTransform(effect: EditorColorRenderEffect): ColorTransform | null {
	switch (effect.effectId) {
		case 'gpu-brightness': {
			const amount = numberParam(effect, 'amount', 0);
			return (red, green, blue) => [red + amount, green + amount, blue + amount];
		}
		case 'gpu-exposure': {
			const multiplier = 2 ** numberParam(effect, 'exposure', 0);
			const offset = numberParam(effect, 'offset', 0);
			const exponent = 1 / Math.max(0.05, numberParam(effect, 'gamma', 1));
			return (red, green, blue) => [
				Math.max(0, red * multiplier + offset) ** exponent,
				Math.max(0, green * multiplier + offset) ** exponent,
				Math.max(0, blue * multiplier + offset) ** exponent
			];
		}
		case 'gpu-contrast': {
			const amount = numberParam(effect, 'amount', 1);
			return (red, green, blue) => [
				(red - 0.5) * amount + 0.5,
				(green - 0.5) * amount + 0.5,
				(blue - 0.5) * amount + 0.5
			];
		}
		case 'gpu-saturation': {
			const amount = numberParam(effect, 'amount', 1);
			return (red, green, blue) => mixSaturation(red, green, blue, amount);
		}
		case 'gpu-vibrance': {
			const amount = numberParam(effect, 'amount', 0);
			return (red, green, blue) => {
				const maximum = Math.max(red, green, blue);
				const minimum = Math.min(red, green, blue);
				const saturation = (maximum - minimum) / (maximum + 0.001);
				return mixSaturation(red, green, blue, 1 + amount * (1 - saturation));
			};
		}
		case 'gpu-hue-shift': {
			const shift = numberParam(effect, 'shift', 0);
			return (red, green, blue) => shiftHue(red, green, blue, shift);
		}
		case 'gpu-temperature': {
			const temperature = numberParam(effect, 'temperature', 0);
			const tint = numberParam(effect, 'tint', 0);
			return (red, green, blue) => [
				red + (temperature * 0.1 + tint * 0.05),
				green - tint * 0.1,
				blue + (-temperature * 0.1 + tint * 0.05)
			];
		}
		case 'gpu-curves': {
			const lookup = buildCurvesLut(effect.params);
			return (red, green, blue) => [
				lookup[quantize(red) * 4] / 255,
				lookup[quantize(green) * 4 + 1] / 255,
				lookup[quantize(blue) * 4 + 2] / 255
			];
		}
		case 'gpu-color-wheels':
			return prepareColorWheels(effect);
		default:
			return null;
	}
}

function prepareColorWheels(effect: EditorColorRenderEffect): ColorTransform {
	const bands = (['shadows', 'midtones', 'highlights', 'offset'] as const).flatMap((band) => {
		const amount = numberParam(effect, `${band}Amount`, 0);
		if (amount < 0.001) return [];
		const tint = hsvToRgb(numberParam(effect, `${band}Hue`, 0) / 360, 1, 1);
		return [
			{
				band,
				red: (tint[0] - 1) * amount,
				green: (tint[1] - 1) * amount,
				blue: (tint[2] - 1) * amount
			}
		];
	});
	const lift = numberParam(effect, 'lift', 0) + numberParam(effect, 'offset', 0);
	const gain = numberParam(effect, 'gain', 1);
	const exponent = 1 / Math.max(0.05, numberParam(effect, 'gamma', 1));
	const shadows = numberParam(effect, 'shadows', 0) / 100;
	const highlights = numberParam(effect, 'highlights', 0) / 100;
	return (red, green, blue) => {
		const luma = luma601(red, green, blue);
		const shadowMask = 1 - smoothstep(0, 0.5, luma);
		const highlightMask = smoothstep(0.5, 1, luma);
		for (const tint of bands) {
			const mask =
				tint.band === 'shadows'
					? shadowMask
					: tint.band === 'midtones'
						? 1 - shadowMask - highlightMask
						: tint.band === 'highlights'
							? highlightMask
							: 1;
			red *= 1 + tint.red * mask;
			green *= 1 + tint.green * mask;
			blue *= 1 + tint.blue * mask;
		}
		const adjustment = shadows * shadowMask + highlights * highlightMask;
		return [
			Math.max(0, (red + lift) * gain) ** exponent + adjustment,
			Math.max(0, (green + lift) * gain) ** exponent + adjustment,
			Math.max(0, (blue + lift) * gain) ** exponent + adjustment
		];
	};
}

function luma601(red: number, green: number, blue: number): number {
	return red * 0.299 + green * 0.587 + blue * 0.114;
}

function mixSaturation(red: number, green: number, blue: number, amount: number) {
	const gray = luma601(red, green, blue);
	return [
		gray + (red - gray) * amount,
		gray + (green - gray) * amount,
		gray + (blue - gray) * amount
	] as const;
}

function shiftHue(red: number, green: number, blue: number, shift: number) {
	const maximum = Math.max(red, green, blue);
	const minimum = Math.min(red, green, blue);
	const delta = maximum - minimum;
	let hue = 0;
	if (delta > 0) {
		if (maximum === red) hue = ((green - blue) / delta) % 6;
		else if (maximum === green) hue = (blue - red) / delta + 2;
		else hue = (red - green) / delta + 4;
		hue /= 6;
	}
	const saturation = maximum === 0 ? 0 : delta / maximum;
	return hsvToRgb((((hue + shift) % 1) + 1) % 1, saturation, maximum);
}

function hsvToRgb(hue: number, saturation: number, value: number) {
	const sector = Math.floor(hue * 6);
	const fraction = hue * 6 - sector;
	const low = value * (1 - saturation);
	const falling = value * (1 - fraction * saturation);
	const rising = value * (1 - (1 - fraction) * saturation);
	switch (sector % 6) {
		case 0:
			return [value, rising, low] as const;
		case 1:
			return [falling, value, low] as const;
		case 2:
			return [low, value, rising] as const;
		case 3:
			return [low, falling, value] as const;
		case 4:
			return [rising, low, value] as const;
		default:
			return [value, low, falling] as const;
	}
}

function smoothstep(edge0: number, edge1: number, value: number): number {
	const position = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
	return position * position * (3 - 2 * position);
}

function quantize(value: number): number {
	return Math.round(Math.max(0, Math.min(1, value)) * 255);
}
