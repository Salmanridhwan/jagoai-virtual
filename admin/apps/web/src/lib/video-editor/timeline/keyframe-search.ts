/**
 * Closing keyframe of a segment in an ascending lane. Callers clamp the first
 * and last frames before searching. An exact interior key uses the preceding
 * segment, preserving its outgoing easing (including hold interpolation).
 */
export function keyframeSegmentEnd(
	keyframes: readonly number[] | readonly { frame: number }[],
	frame: number
): number {
	let low = 1;
	let high = keyframes.length - 1;
	while (low < high) {
		const middle = (low + high) >>> 1;
		const keyframe = keyframes[middle];
		// oxlint-disable-next-line anti-slop/no-runtime-typeof -- Scalar and vector lanes have distinct, already-typed storage representations.
		const at = typeof keyframe === 'number' ? keyframe : keyframe.frame;
		if (frame > at) low = middle + 1;
		else high = middle;
	}
	return low;
}
