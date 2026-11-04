// Media tool limits live apart from the conversion module so the generated
// guides and page copy do not pull mediabunny into every tool route.

export const MEDIA_MAX_BYTES = 250 * 1024 * 1024;
export const OUTPUT_MAX_BYTES = 500 * 1024 * 1024;

// Whole-MB labels for authored limits. Formatting from the byte value keeps the
// displayed copy in step when a limit changes.
export function mediaLimitLabel(bytes: number): string {
	return `${bytes / 1024 / 1024} MB`;
}
