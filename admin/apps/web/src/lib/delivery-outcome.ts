export type DeliveryOutcomeBucket = 'succeeded' | 'pending' | 'failed' | 'manual';

export type DeliveryOutcomeInput = {
	status: string;
	delivery?: {
		state?: string | null;
		recovery_action?: string | null;
	} | null;
};

export type DeliveryOutcomeCounts = Record<DeliveryOutcomeBucket, number>;

export function deliveryOutcomeBucket(rendition: DeliveryOutcomeInput): DeliveryOutcomeBucket {
	const state = rendition.delivery?.state || rendition.status;
	if (state === 'live' || state === 'published' || state === 'success') return 'succeeded';
	if (
		state === 'ambiguous' ||
		state === 'manual_resolution' ||
		rendition.delivery?.recovery_action === 'reconcile' ||
		rendition.delivery?.recovery_action === 'manual_resolution'
	) {
		return 'manual';
	}
	if (state === 'rejected' || state === 'failed') return 'failed';
	return 'pending';
}

export function deliveryOutcomeSummary(renditions: DeliveryOutcomeInput[]) {
	const counts = {
		succeeded: 0,
		pending: 0,
		failed: 0,
		manual: 0
	} satisfies DeliveryOutcomeCounts;
	for (const rendition of renditions) counts[deliveryOutcomeBucket(rendition)] += 1;
	return counts;
}
