import type { ComposerSettings } from './modes';
import type { VariantPost } from './draft-utils';

/** The fields the resolver reads from an AI attachment requirement. */
interface AttachmentRequirementLike {
	kind?: string;
	brief?: string;
}

/**
 * A destination only needs its own segment copy when it customizes authored
 * content or delivery state. Sending identical segments once per account makes
 * the server re-read the same media for every destination.
 */
export function accountNeedsSegmentCopy(
	accountID: string,
	variants: ReadonlyMap<string, Record<string, VariantPost>>,
	attachmentRequirements: Record<string, AttachmentRequirementLike>,
	hasSharedPoll: boolean,
	mediaSettingsByAccount: Record<string, Record<string, ComposerSettings>>
): boolean {
	if (Object.keys(variants.get(accountID) ?? {}).length > 0) return true;
	if (attachmentRequirements[accountID]) return true;
	if (hasSharedPoll) return true;
	return Object.values(mediaSettingsByAccount).some(
		(byAccount) => byAccount[accountID] !== undefined
	);
}
