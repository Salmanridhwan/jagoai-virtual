import { z } from 'zod';

const assetSchema = z.object({ id: z.string(), name: z.string(), mayPublish: z.boolean() });

const draftSchema = z.object({
	idea: z.string(),
	seriesMode: z.boolean().default(false),
	accountIds: z.array(z.string()),
	setId: z.string(),
	voiceId: z.string(),
	notes: z.string(),
	links: z.string(),
	direction: z.string(),
	assets: z.array(assetSchema),
	availableAssets: z.array(assetSchema).default([]),
	lockedDirection: z.object({
		outcome: z.string().optional(),
		audience: z.string().optional(),
		angle: z.string().optional(),
		media_preference: z.string().optional(),
		tone_adjustment: z.string().optional()
	}),
	contextMayPublish: z.boolean(),
	creationKey: z.string(),
	requestFingerprint: z.string(),
	buildId: z.string().optional(),
	pending: z.array(
		z.object({ optionId: z.string(), revision: z.number().int().positive(), body: z.string() })
	)
});

export type IdeateDraft = z.infer<typeof draftSchema>;

export function readIdeateDraft(key: string): IdeateDraft | undefined {
	try {
		const value = sessionStorage.getItem(key);
		if (!value) return;
		const parsed = draftSchema.safeParse(JSON.parse(value));
		if (parsed.success) return parsed.data;
	} catch {
		// A blocked device store must not prevent creation or server build recovery.
	}
}

export function writeIdeateDraft(key: string, value: IdeateDraft): boolean {
	try {
		sessionStorage.setItem(key, JSON.stringify(value));
		return true;
	} catch {
		return false;
	}
}
