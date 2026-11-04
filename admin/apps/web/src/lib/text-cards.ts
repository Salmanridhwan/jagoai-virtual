import type { components } from '$lib/api/types';
import type { ComposerSettingValue, ComposerSettings } from '$lib/components/compose/modes';
import type { PreviewModel } from '@openpost/social-preview';

// The served request body carries a free-form settings bag, but every text-card
// settings value the composer produces is a ComposerSettingValue. Narrow the
// generated type so the catalogue defaults and authored settings stay checked
// at the same boundary as the rest of the composer.
export type TextCardRequest = Omit<
	components['schemas']['PreviewTextCardInputBody'],
	'settings'
> & { settings?: ComposerSettings };
export type TextCardImage = components['schemas']['TextCardPreviewImage'];
export interface TextCardResult {
	key: string;
	images: TextCardImage[];
	loading: boolean;
	error: string;
}

// Identity fields the server render receipt hashes (publicationcards
// Identity + the avatar URL). The preview request body carries only the
// account id, so callers pass the current identity alongside the request
// when computing cache keys. A relevant alias, handle or avatar change must
// invalidate the saved client preview exactly when it invalidates the saved
// server output.
export interface TextCardIdentity {
	name: string;
	handle: string;
	avatar: string;
}

export function textCardIdentityForAccount(account: {
	alias?: string | null;
	account_username?: string | null;
	slug?: string | null;
	account_avatar_url?: string | null;
}): TextCardIdentity {
	const username = account.account_username ?? '';
	const name = (account.alias ?? '').trim() || username || account.slug || '';
	return { name, handle: username, avatar: account.account_avatar_url ?? '' };
}

export function supportsTextCards(provider: string, output = ''): boolean {
	return provider === 'instagram'
		? ['', 'instagram.feed', 'instagram.carousel', 'instagram.story'].includes(output)
		: provider === 'pixelfed' && ['', 'pixelfed.post', 'pixelfed.carousel'].includes(output);
}

export function textCardSettings(settings: ComposerSettings): ComposerSettings {
	return Object.fromEntries(
		Object.entries(settings).filter(([key]) => key === 'text_card' || key.startsWith('text_card_'))
	);
}

// Minimal structural view of a capability setting definition. The resolved
// capability (settings plus setting groups) carries the catalogue default for
// every text-card key; the server textcards package owns those values and the
// client must read them here rather than restating its own literal copy.
export interface TextCardCatalogueDefinition {
	key: string;
	default?: unknown;
}

export interface TextCardCatalogueSource {
	settings?: readonly (TextCardCatalogueDefinition | null | undefined)[] | null | undefined;
	setting_groups?:
		| readonly {
				settings?: readonly (TextCardCatalogueDefinition | null | undefined)[] | null | undefined;
		  }[]
		| null
		| undefined;
}

function isCatalogueDefinitionList(
	source:
		| TextCardCatalogueSource
		| readonly (TextCardCatalogueDefinition | null | undefined)[]
		| null
		| undefined
): source is readonly (TextCardCatalogueDefinition | null | undefined)[] {
	return Array.isArray(source);
}

function isComposerSettingScalar(value: unknown): value is string | number | boolean {
	return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

// Catalogue defaults arrive as untyped JSON. Only scalar and scalar-array
// values are composer settings; anything else is ignored rather than stored.
function isComposerSettingValue(value: unknown): value is ComposerSettingValue {
	if (value === null) return true;
	if (isComposerSettingScalar(value)) return true;
	return Array.isArray(value) && value.every(isComposerSettingScalar);
}

// textCardDefaultsFrom resolves the text-card defaults once from the capability
// catalogue (a resolved account capability or a flat setting-definition list).
// Callers merge the result into authored settings before computing a request
// key so omitted styling keys follow the catalogue instead of a literal.
export function textCardDefaultsFrom(
	source:
		| TextCardCatalogueSource
		| readonly (TextCardCatalogueDefinition | null | undefined)[]
		| null
		| undefined
): ComposerSettings {
	const definitions: readonly (TextCardCatalogueDefinition | null | undefined)[] =
		isCatalogueDefinitionList(source)
			? source
			: [
					...(source?.settings ?? []),
					...(source?.setting_groups ?? []).flatMap((group) => group?.settings ?? [])
				];
	const defaults: ComposerSettings = {};
	for (const definition of definitions) {
		if (!definition || !definition.key.startsWith('text_card')) continue;
		if (definition.default === undefined || definition.default === null) continue;
		if (!isComposerSettingValue(definition.default)) continue;
		defaults[definition.key] = definition.default;
	}
	return defaults;
}

// withTextCardDefaults merges catalogue defaults under authored settings.
// Explicit values win; only undefined falls back to the catalogue default.
export function withTextCardDefaults(
	settings: { [key: string]: ComposerSettingValue | undefined },
	defaults: ComposerSettings
): ComposerSettings {
	const merged: ComposerSettings = { ...defaults };
	for (const [key, value] of Object.entries(settings)) {
		if (value !== undefined) merged[key] = value;
	}
	return merged;
}

export function textCardRequest(
	accountId: string,
	model: PreviewModel,
	settings: ComposerSettings,
	outputProfile: string
): TextCardRequest | null {
	const text = model.segments
		.map((segment) => segment.text.trim())
		.filter(Boolean)
		.join('\n\n');
	const attachments =
		new Set(model.segments.flatMap((segment) => (segment.media ?? []).map((media) => media.id)))
			.size || model.media.length;
	if (!supportsTextCards(model.platform, outputProfile) || !text.trim()) return null;
	if (settings.text_card !== 'always' && !(settings.text_card === 'text_only' && attachments === 0))
		return null;
	return {
		social_account_id: accountId,
		text,
		output_profile: outputProfile,
		attachment_count: attachments,
		settings: textCardSettings(settings)
	};
}

export function withTextCardImages(model: PreviewModel, images: TextCardImage[]): PreviewModel {
	if (!images.length) return model;
	const text = model.segments
		.map((segment) => segment.text.trim())
		.filter(Boolean)
		.join('\n\n');
	const cards = images.map((image, index) => ({
		id: `text-card:${index}`,
		kind: 'image' as const,
		src: image.data_url,
		alt: text,
		aspectRatio: image.width / image.height
	}));
	const attachments = new Map<string, PreviewModel['media'][number]>();
	for (const media of [
		...model.segments.flatMap((segment) => segment.media ?? []),
		...model.media
	]) {
		if (!attachments.has(media.id)) attachments.set(media.id, media);
	}
	const media = [...cards, ...attachments.values()];
	return { ...model, media, segments: [{ ...model.segments[0], text, media }] };
}

export function textCardRequestKey(
	request: TextCardRequest | null,
	identity?: TextCardIdentity | null,
	defaults: ComposerSettings = {}
): string {
	if (!request) return '';
	// Callers merge catalogue defaults (textCardDefaultsFrom) into the settings
	// before this key is computed, so omitted styling matches the resolved
	// capability instead of a restated literal. The neutral fallbacks below only
	// fire when the catalogue itself has no default for the key.
	const settings = withTextCardDefaults(request.settings ?? {}, defaults);
	return JSON.stringify([
		request.social_account_id,
		request.text.trim(),
		request.output_profile === 'instagram.story',
		request.attachment_count ?? 0,
		identity?.name ?? '',
		identity?.handle ?? '',
		identity?.avatar ?? '',
		settings.text_card_appearance ?? '',
		settings.text_card_background ?? '',
		settings.text_card_color ?? '',
		settings.text_card_color_end ?? '',
		settings.text_card_rounded ?? null,
		settings.text_card_shadow ?? null
	]);
}

export function savedTextCardPreviews(
	renditions: components['schemas']['RenditionResponse'][] = [],
	identities: Record<string, TextCardIdentity | undefined> = {},
	defaults: ComposerSettings
) {
	const previews: Record<string, TextCardResult> = {};
	for (const rendition of renditions) {
		const segments = rendition.segments ?? [];
		const cards = segments
			.flatMap((segment) => segment.output_media ?? [])
			.filter((media) => media.role === 'text_card');
		if (!cards.length) continue;
		const request: TextCardRequest = {
			social_account_id: rendition.social_account_id,
			text: segments
				.map((segment) => segment.body.trim())
				.filter(Boolean)
				.join('\n\n'),
			output_profile: rendition.output_profile,
			attachment_count: new Set(
				segments.flatMap((segment) => (segment.media ?? []).map((media) => media.id))
			).size,
			// SAFETY: stored rendition settings are authored through the composer,
			// so their values are ComposerSettingValue; the preview endpoint
			// revalidates every key it receives.
			settings: (rendition.settings ?? {}) as ComposerSettings
		};
		previews[rendition.social_account_id] = {
			key: textCardRequestKey(request, identities[rendition.social_account_id], defaults),
			images: cards.map((media) => ({
				data_url: media.url,
				width: media.width,
				height: media.height
			})),
			loading: false,
			error: ''
		};
	}
	return previews;
}
