import { createPreviewModel } from '@openpost/social-preview';
import { expect, it } from 'vitest';
import {
	textCardDefaultsFrom,
	textCardIdentityForAccount,
	textCardRequest,
	textCardRequestKey,
	withTextCardDefaults,
	withTextCardImages
} from './text-cards';

it('joins a card and unique attachments in source order, retaining the first alt text', () => {
	const model = createPreviewModel({
		platform: 'instagram',
		identity: { displayName: 'Founder', handle: 'founder' },
		segments: [
			{
				id: 'a',
				text: 'First',
				media: [{ id: 'photo', kind: 'image', src: '/first.jpg', alt: 'First description' }]
			},
			{
				id: 'b',
				text: 'Second',
				media: [
					{ id: 'photo', kind: 'image', src: '/second.jpg', alt: 'Later description' },
					{ id: 'clip', kind: 'video', src: '/clip.mp4' }
				]
			}
		]
	});
	const request = textCardRequest('account', model, { text_card: 'always' }, 'instagram.carousel');
	expect(request).toMatchObject({ text: 'First\n\nSecond', attachment_count: 2 });
	const preview = withTextCardImages(model, [
		{ data_url: '/saved-card.jpg', width: 1080, height: 1350 }
	]);
	expect(preview.segments).toHaveLength(1);
	expect(preview.media.map((media) => media.src)).toEqual([
		'/saved-card.jpg',
		'/first.jpg',
		'/clip.mp4'
	]);
	expect(preview.media[1].alt).toBe('First description');
});

it('reads text-card defaults from the resolved capability catalogue', () => {
	const resolved = {
		setting_groups: [
			{
				key: 'content',
				settings: [
					{ key: 'text_card_color', default: '#101010' },
					{ key: 'unrelated_setting', default: 'ignored-never-matches-prefix' }
				]
			}
		],
		settings: [
			{ key: 'text_card_color_end', default: '#202020' },
			{ key: 'text_card_appearance', default: 'dark' },
			{ key: 'text_card_rounded', default: false },
			{ key: 'text_card_shadow', default: true },
			{ key: 'text_card_background', default: 'mesh' },
			{ key: 'text_card', default: 'text_only' },
			{ key: 'other_setting', default: 'ignored' },
			{ key: 'text_card_color_unset', default: undefined }
		]
	};
	expect(textCardDefaultsFrom(resolved)).toMatchObject({
		text_card_color: '#101010',
		text_card_color_end: '#202020',
		text_card_appearance: 'dark',
		text_card_rounded: false,
		text_card_shadow: true,
		text_card_background: 'mesh',
		text_card: 'text_only'
	});
	expect(textCardDefaultsFrom(resolved)).not.toHaveProperty('other_setting');
	expect(textCardDefaultsFrom(resolved)).not.toHaveProperty('unrelated_setting');
	// A flat definition list works too, for callers that already hold settings.
	expect(
		textCardDefaultsFrom([
			{ key: 'text_card_color', default: '#303030' },
			{ key: 'other_setting', default: 'ignored' }
		])
	).toEqual({ text_card_color: '#303030' });
	expect(textCardDefaultsFrom(null)).toEqual({});
	expect(textCardDefaultsFrom(undefined)).toEqual({});
});

it('lets explicit text-card values win over catalogue defaults when merging', () => {
	const merged = withTextCardDefaults(
		{ text_card: 'always', text_card_color: '#404040', text_card_rounded: undefined },
		{ text_card: 'text_only', text_card_color: '#101010', text_card_rounded: false }
	);
	expect(merged).toMatchObject({
		text_card: 'always',
		text_card_color: '#404040',
		text_card_rounded: false
	});
});

it('keys omitted text-card styling by the catalogue defaults instead of a literal', () => {
	const defaults = textCardDefaultsFrom({
		settings: [
			{ key: 'text_card_appearance', default: 'light' },
			{ key: 'text_card_background', default: 'gradient' },
			{ key: 'text_card_color', default: '#101010' },
			{ key: 'text_card_color_end', default: '#202020' },
			{ key: 'text_card_rounded', default: true },
			{ key: 'text_card_shadow', default: true }
		],
		setting_groups: []
	});
	const omitted = {
		social_account_id: 'account',
		text: 'A saved post',
		attachment_count: 0,
		settings: { text_card: 'text_only' }
	};
	const explicit = {
		...omitted,
		settings: {
			text_card: 'text_only',
			text_card_appearance: 'light',
			text_card_background: 'gradient',
			text_card_color: '#101010',
			text_card_color_end: '#202020',
			text_card_rounded: true,
			text_card_shadow: true
		}
	};
	expect(textCardRequestKey(omitted, undefined, defaults)).toBe(
		textCardRequestKey(explicit, undefined, defaults)
	);
	// The key follows the catalogue: a different catalogue default is a different key.
	expect(
		textCardRequestKey(omitted, undefined, { ...defaults, text_card_color: '#303030' })
	).not.toBe(textCardRequestKey(omitted, undefined, defaults));
});

it('reuses the same saved image across automatic format resolution and explicit default styling', () => {
	const defaults = textCardDefaultsFrom({
		settings: [
			{ key: 'text_card_appearance', default: 'light' },
			{ key: 'text_card_background', default: 'gradient' },
			{ key: 'text_card_color', default: '#101010' },
			{ key: 'text_card_color_end', default: '#202020' },
			{ key: 'text_card_rounded', default: true },
			{ key: 'text_card_shadow', default: true }
		],
		setting_groups: []
	});
	const request = {
		social_account_id: 'account',
		text: 'A saved post',
		attachment_count: 0,
		settings: withTextCardDefaults({ text_card: 'text_only' }, defaults)
	};
	expect(textCardRequestKey(request, undefined, defaults)).toBe(
		textCardRequestKey(
			{
				...request,
				output_profile: 'instagram.feed',
				settings: { ...request.settings, text_card_appearance: 'light' }
			},
			undefined,
			defaults
		)
	);
	expect(textCardRequestKey(request, undefined, defaults)).not.toBe(
		textCardRequestKey({ ...request, output_profile: 'instagram.story' }, undefined, defaults)
	);
	expect(textCardRequestKey(request, undefined, defaults)).not.toBe(
		textCardRequestKey({ ...request, text: 'Changed' }, undefined, defaults)
	);
	expect(textCardRequestKey(request, undefined, defaults)).not.toBe(
		textCardRequestKey({ ...request, attachment_count: 1 }, undefined, defaults)
	);
});

it('derives the card identity from the same fields the server render receipt hashes', () => {
	expect(
		textCardIdentityForAccount({
			alias: 'Launch Buddy',
			account_username: 'founder',
			slug: 'founder',
			account_avatar_url: 'https://cdn.example/a.png'
		})
	).toEqual({ name: 'Launch Buddy', handle: 'founder', avatar: 'https://cdn.example/a.png' });
	expect(textCardIdentityForAccount({ account_username: 'founder', slug: 'founder' }).name).toBe(
		'founder'
	);
	expect(textCardIdentityForAccount({ slug: 'founder' }).name).toBe('founder');
});

it('invalidates the preview key when account identity or the avatar changes', () => {
	const request = {
		social_account_id: 'account',
		text: 'A saved post',
		attachment_count: 0,
		settings: { text_card: 'text_only' }
	};
	const identity = {
		name: 'Founder',
		handle: 'founder',
		avatar: 'https://cdn.example/a.png'
	};
	expect(textCardRequestKey(request, identity)).toBe(textCardRequestKey(request, identity));
	expect(textCardRequestKey(request, identity)).not.toBe(
		textCardRequestKey(request, { ...identity, name: 'Renamed' })
	);
	expect(textCardRequestKey(request, identity)).not.toBe(
		textCardRequestKey(request, { ...identity, handle: 'someone-else' })
	);
	expect(textCardRequestKey(request, identity)).not.toBe(
		textCardRequestKey(request, { ...identity, avatar: 'https://cdn.example/b.png' })
	);
});
