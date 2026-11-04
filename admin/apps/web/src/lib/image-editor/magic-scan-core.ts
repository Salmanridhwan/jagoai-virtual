import type { SelectionPoint } from './selection';

export interface MagicPixelScanInput {
	width: number;
	height: number;
	data: Uint8ClampedArray;
	point: SelectionPoint;
	tolerance: number;
	contiguous: boolean;
}

export interface MagicPixelScanOptions {
	shouldCancel?: () => boolean;
	onProgress?: (fraction: number) => void;
	yieldEvery?: number;
	/** Workers can report progress without yielding their dedicated thread. */
	yieldToEventLoop?: boolean;
}

export async function scanMagicPixels(
	input: MagicPixelScanInput,
	options: MagicPixelScanOptions = {}
): Promise<Uint8Array> {
	if (options.shouldCancel?.()) throw new DOMException('Pixel scan cancelled.', 'AbortError');
	const { width, height, data } = input;
	const total = width * height;
	const mask = new Uint8Array(total);
	if (total === 0 || data.length < total * 4) return mask;
	const startX = clamp(Math.floor(input.point.x), 0, width - 1);
	const startY = clamp(Math.floor(input.point.y), 0, height - 1);
	const startIndex = startY * width + startX;
	const sampleOffset = startIndex * 4;
	const sample = [
		data[sampleOffset] ?? 0,
		data[sampleOffset + 1] ?? 0,
		data[sampleOffset + 2] ?? 0,
		data[sampleOffset + 3] ?? 0
	];
	const tolerance = clamp(input.tolerance, 0, 255);
	const yieldEvery = Math.max(4_096, options.yieldEvery ?? 65_536);
	const checkpoint = async (completed: number): Promise<void> => {
		if (options.shouldCancel?.()) throw new DOMException('Pixel scan cancelled.', 'AbortError');
		options.onProgress?.(Math.max(0, Math.min(1, completed / Math.max(1, total))));
		if (options.yieldToEventLoop !== false)
			await new Promise<void>((resolve) => setTimeout(resolve, 0));
		if (options.shouldCancel?.()) throw new DOMException('Pixel scan cancelled.', 'AbortError');
	};
	const matches = (index: number): boolean => {
		const offset = index * 4;
		return (
			Math.max(
				Math.abs((data[offset] ?? 0) - sample[0]),
				Math.abs((data[offset + 1] ?? 0) - sample[1]),
				Math.abs((data[offset + 2] ?? 0) - sample[2]),
				Math.abs((data[offset + 3] ?? 0) - sample[3])
			) <= tolerance
		);
	};

	if (!input.contiguous) {
		for (let index = 0; index < total; index++) {
			if (matches(index)) mask[index] = 1;
			if (index > 0 && index % yieldEvery === 0) await checkpoint(index);
		}
		options.onProgress?.(1);
		return mask;
	}

	// Flood whole horizontal spans. The output mask also marks queued seeds,
	// avoiding a visited image and a queue allocated for every source pixel.
	let stack = new Uint32Array(Math.min(total, 1024));
	let size = 0;
	const enqueue = (index: number): void => {
		if (size === stack.length) {
			const grown = new Uint32Array(Math.min(total, stack.length * 2));
			grown.set(stack);
			stack = grown;
		}
		mask[index] = 2;
		stack[size++] = index;
	};
	if (!matches(startIndex)) return mask;
	enqueue(startIndex);
	let processed = 0;
	let nextYield = yieldEvery;
	while (size > 0) {
		const index = stack[--size];
		if (mask[index] === 1) continue;
		const rowStart = index - (index % width);
		const rowEnd = rowStart + width;
		let left = index;
		let right = index + 1;
		while (left > rowStart && mask[left - 1] !== 1 && matches(left - 1)) left--;
		while (right < rowEnd && mask[right] !== 1 && matches(right)) right++;
		mask.fill(1, left, right);
		processed += right - left;
		for (const offset of [-width, width]) {
			if (left + offset < 0 || left + offset >= total) continue;
			let inSpan = false;
			for (let neighbor = left + offset; neighbor < right + offset; neighbor++) {
				if (mask[neighbor] === 2) {
					inSpan = true;
				} else if (mask[neighbor] === 0 && matches(neighbor)) {
					if (!inSpan) enqueue(neighbor);
					inSpan = true;
				} else {
					inSpan = false;
				}
			}
		}
		if (processed >= nextYield) {
			await checkpoint(processed);
			nextYield = processed + yieldEvery;
		}
	}
	options.onProgress?.(1);
	return mask;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(maximum, value));
}
