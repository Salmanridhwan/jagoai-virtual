/**
 * Single owner for byte-size formatting (issue #376).
 *
 * Thirteen separate formatters previously disagreed on the same input (2 GiB
 * read "2.0 GB" in one screen and "2048.0 MB" in another) and one returned an
 * English sentence from a formatting helper. Every formatter in scope now
 * delegates here; each caller passes an explicit unit base.
 *
 * Unit table (shared labels, explicit divisor):
 * - base 'iec' (binary file sizes: media library, video constraints,
 *   recorder): B, KB, MB, GB, TB, each step dividing by 1024.
 * - base 'si' (decimal billing surfaces: plan limits, quotas): B, KB, MB, GB,
 *   TB, each step dividing by 1000.
 * Labels stay KB/MB (not KiB/MiB) to match existing screens; only the divisor
 * differs between bases.
 *
 * Ceiling rule: TB is the largest unit. Values beyond TB stay in TB
 * ("1024 TB") rather than inventing larger units no surface designs for.
 *
 * Precision rule: bytes below one step render as whole bytes ("1 B", never
 * "1 KB"); KB and above render with at most `maximumFractionDigits`
 * (default 1) significant fraction digits via `Intl.NumberFormat`, so whole
 * values shed trailing zeros ("2 GB", not "2.0 GB").
 *
 * Localization rule: digits and separators come from `Intl.NumberFormat`
 * with the caller's locale, so a `fr` locale renders "1,5 GB". The default
 * is the runtime locale; UI callers pass `getLocaleTag()` explicitly. This
 * module imports nothing so recorder helpers that are imported directly
 * (for example under `bun -e`) stay import-clean.
 *
 * Invalid input rule: non-finite or negative input returns `undefined`
 * (a semantic result, never copy and never "Infinity MB"). The caller
 * decides whether and how to show a fallback message.
 */
export type ByteSizeBase = 'iec' | 'si';

export interface FormatBytesOptions {
	/** BCP 47 tag. Defaults to the runtime locale; UI callers pass `getLocaleTag()`. */
	locale?: string;
	/**
	 * 'iec' divides by 1024 (file sizes); 'si' divides by 1000 (billing).
	 * Defaults to 'iec'.
	 */
	base?: ByteSizeBase;
	/** Maximum fraction digits for KB and above. Defaults to 1. */
	maximumFractionDigits?: number;
}

export function formatBytes(bytes: number, opts?: FormatBytesOptions): string | undefined {
	if (!Number.isFinite(bytes) || bytes < 0) return undefined;
	const base = opts?.base ?? 'iec';
	const step = base === 'si' ? 1000 : 1024;
	const locale = opts?.locale ?? Intl.NumberFormat().resolvedOptions().locale;
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	if (bytes < step) {
		const whole = Math.round(bytes);
		const digits = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
			whole === 0 ? 0 : whole
		);
		return `${digits} B`;
	}
	let unit = 0;
	let value = bytes;
	while (value >= step && unit < units.length - 1) {
		value /= step;
		unit += 1;
	}
	const digits = new Intl.NumberFormat(locale, {
		maximumFractionDigits: opts?.maximumFractionDigits ?? 1
	}).format(value);
	return `${digits} ${units[unit]}`;
}
