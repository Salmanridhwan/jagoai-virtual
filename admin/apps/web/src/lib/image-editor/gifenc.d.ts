declare module 'gifenc' {
	export function quantize(
		rgba: Uint8Array | Uint8ClampedArray,
		maxColors: number,
		options?: { format?: 'rgb565' | 'rgb444' | 'rgba4444' }
	): number[][];
	export function applyPalette(
		rgba: Uint8Array | Uint8ClampedArray,
		palette: number[][],
		format?: 'rgb565' | 'rgb444' | 'rgba4444'
	): Uint8Array;
	export function GIFEncoder(): {
		writeFrame(
			index: Uint8Array,
			width: number,
			height: number,
			options: {
				palette: number[][];
				delay: number;
				repeat: number;
				dispose: number;
				transparent: boolean;
				transparentIndex: number;
			}
		): void;
		finish(): void;
		bytes(): Uint8Array<ArrayBuffer>;
		bytesView(): Uint8Array;
	};
}
