import type { components } from '$lib/api/types';

type ResolvedAccountCapability = components['schemas']['ResolvedAccountCapability'];

/**
 * Readiness stays usable while a background resolve refreshes it.
 * The previous answer remains valid for the same accounts; only a missing
 * answer or a failed refresh should block publishing and hide requirements.
 */
export function hasUsableCapabilities(
	selectedAccountIds: readonly string[],
	resolvedCapabilities: Record<string, Partial<ResolvedAccountCapability>>,
	resolveError: string
): boolean {
	if (resolveError || selectedAccountIds.length === 0) return false;
	return selectedAccountIds.every((accountID) => Boolean(resolvedCapabilities[accountID]));
}

/**
 * A resolve may finish after the composer moved on. Its provider work still
 * warms the cache, but its answer must never replace newer state.
 */
export function capabilityResponseApplies(params: {
	requestSequence: number;
	currentRequestSequence: number;
	requestedSnapshot: string;
	currentSnapshot: string;
}): boolean {
	return (
		params.requestSequence === params.currentRequestSequence &&
		params.requestedSnapshot === params.currentSnapshot
	);
}

/** A submit decision needs an answer that was applied for the current state. */
export function capabilityResolutionIsFresh(
	appliedSnapshot: string,
	currentSnapshot: string,
	resolveError: string
): boolean {
	return resolveError === '' && appliedSnapshot === currentSnapshot;
}
