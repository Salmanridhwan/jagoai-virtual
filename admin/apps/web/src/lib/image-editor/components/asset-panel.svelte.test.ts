import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { ImageEditorController } from '../editor.svelte';
import {
	createGuestImageEditorDesign,
	storeGuestImageEditorMedia,
	deleteGuestImageEditorDesign
} from '../local-persistence';
import {
	registerLocalImageEditorMedia,
	releaseLocalImageEditorMedia,
	localImageEditorMediaURL,
	releaseLocalImageEditorMediaForDesign
} from '../local-media-url';
import Fixture from './asset-panel.fixture.svelte';
import '../../../routes/layout.css';

const stock = vi.hoisted(() => ({ download: vi.fn() }));
// Real stock controls exercise a delayed external download through the real panel.
// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('$lib/stock-media', async (original) => ({
	...(await original<typeof import('$lib/stock-media')>()),
	listStockProviders: async () => [
		{
			key: 'pexels',
			name: 'Pexels',
			photos: true,
			videos: false,
			audio: false,
			provider_url: 'https://example.com',
			attribution: 'Own image'
		}
	],
	searchStockMedia: async () => ({
		items: [
			{
				provider: 'pexels',
				external_id: 'own',
				kind: 'photo',
				title: 'Own image',
				width: 8,
				height: 8,
				thumbnail_url: '',
				source_url: 'https://example.com/image',
				creator_name: 'Author',
				creator_url: 'https://example.com',
				provider_url: 'https://example.com',
				attribution_text: 'Own image',
				license_name: 'Own license',
				license_url: 'https://example.com/license'
			}
		],
		page: 1,
		has_more: false,
		total: 1
	}),
	resolveStockAsset: async () => ({}),
	downloadStockAsset: stock.download
}));

// Query replies isolate filtered discovery from ID-based selection without changing editor code.
// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('$lib/query/image-editor', () => ({
	queryImageEditorMedia: async () => [],
	queryImageEditorBrandKit: async () => null
}));
// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('$lib/query/media', async (original) => ({
	...(await original<typeof import('$lib/query/media')>()),
	queryMediaMetadata: async () => ({
		media: [
			{
				id: 'local_media_unlisted',
				original_filename: 'unlisted.gif',
				mime_type: 'image/gif',
				width: 8,
				height: 8
			}
		]
	})
}));
// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('$lib/media-tags', () => ({ listMediaTags: async () => ({ tags: [] }) }));
// The picker owns uploads; this fixture delivers its selected ID to the real asset-panel callback.
// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('$lib/components/media-picker.svelte', async () => ({
	default: (await import('./asset-picker.fixture.svelte')).default
}));

it('preserves animation and filename when a picker selection is outside filtered results', async () => {
	const blob = await (
		await fetch(new URL('../../video-editor/media/fixtures/animated-rgb.gif', import.meta.url))
	).blob();
	registerLocalImageEditorMedia('local_media_unlisted', blob);
	const design = await createGuestImageEditorDesign(
		{
			key: 'custom',
			name: 'Test',
			width_px: 64,
			height_px: 64,
			default_format: 'png',
			profiles: []
		},
		'Asset regression'
	);
	const editor = new ImageEditorController();
	editor.load(design);
	try {
		const screen = await render(Fixture, { editor, guestMode: false });
		await screen.getByRole('button', { name: 'Device', exact: true }).click();
		await screen.getByRole('button', { name: 'Choose unlisted GIF' }).click();
		await expect.poll(() => editor.activePage?.layers.length).toBe(1);
		expect(editor.activePage?.layers[0].name).toBe('unlisted.gif');
		expect(editor.activePage?.layers[0].image?.animation?.frames).toHaveLength(3);
	} finally {
		releaseLocalImageEditorMedia('local_media_unlisted');
		await deleteGuestImageEditorDesign(design.id);
	}
});

it('keeps a pending GIF layer insertion separate from a newly opened background picker', async () => {
	const file = new File(
		[
			await (
				await fetch(new URL('../../video-editor/media/fixtures/animated-rgb.gif', import.meta.url))
			).blob()
		],
		'animation.gif',
		{ type: 'image/gif' }
	);
	const design = await createGuestImageEditorDesign(
		{
			key: 'custom',
			name: 'Test',
			width_px: 64,
			height_px: 64,
			default_format: 'png',
			profiles: []
		},
		'Asset regression'
	);
	const media = await storeGuestImageEditorMedia(design.id, file);
	const editor = new ImageEditorController();
	editor.load(design);
	const url = localImageEditorMediaURL(media.id)!;
	const rawFetch = globalThis.fetch;
	let pending = false;
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
		if (String(input) === url) {
			pending = true;
			await gate;
		}
		return rawFetch(input, init);
	});
	try {
		const screen = await render(Fixture, { editor });
		await screen.getByRole('button', { name: /animation.gif/ }).click();
		await expect.poll(() => pending).toBe(true);
		editor.backgroundImagePickerActive = true;
		release();
		await expect.poll(() => editor.activePage?.layers.length).toBe(1);
		expect(editor.activePage?.layers[0].image?.animation?.frames).toHaveLength(3);
		expect(editor.activePage?.background?.type).toBe('solid');
		expect(editor.backgroundImagePickerActive).toBe(true);
	} finally {
		release();
		spy.mockRestore();
		releaseLocalImageEditorMediaForDesign(design.id);
		await deleteGuestImageEditorDesign(design.id);
	}
});

it.each(['layer', 'cancelled-background'])(
	'retains the original %s destination through guest GIF storage',
	async (operation) => {
		const blob = await (
			await fetch(new URL('../../video-editor/media/fixtures/animated-rgb.gif', import.meta.url))
		).blob();
		const design = await createGuestImageEditorDesign(
			{
				key: 'custom',
				name: 'Test',
				width_px: 64,
				height_px: 64,
				default_format: 'png',
				profiles: []
			},
			'Upload regression'
		);
		const editor = new ImageEditorController();
		editor.load(design);
		editor.backgroundImagePickerActive = operation === 'cancelled-background';
		try {
			const screen = await render(Fixture, { editor });
			const input = screen.container.querySelector<HTMLInputElement>('input[type=file]')!;
			const transfer = new DataTransfer();
			transfer.items.add(new File([blob], 'uploaded.gif', { type: 'image/gif' }));
			input.files = transfer.files;
			input.dispatchEvent(new Event('change', { bubbles: true }));
			editor.backgroundImagePickerActive = false;
			editor.backgroundImagePickerActive = true;
			await expect.poll(() => input.value).toBe('');
			expect(editor.activePage?.background?.type).toBe('solid');
			if (operation === 'layer') {
				await expect.poll(() => editor.activePage?.layers.length).toBe(1);
				expect(editor.activePage?.layers[0].image?.animation?.frames).toHaveLength(3);
			} else expect(editor.activePage?.layers).toHaveLength(0);
			expect(editor.backgroundImagePickerActive).toBe(true);
		} finally {
			releaseLocalImageEditorMediaForDesign(design.id);
			await deleteGuestImageEditorDesign(design.id);
		}
	}
);

it('keeps a stock download from inserting into a newly selected page', async () => {
	const blob = await (
		await fetch(new URL('../../video-editor/media/fixtures/animated-rgb.gif', import.meta.url))
	).blob();
	const pending = Promise.withResolvers<File>();
	stock.download.mockReturnValueOnce(pending.promise);
	const design = await createGuestImageEditorDesign(
		{
			key: 'custom',
			name: 'Test',
			width_px: 64,
			height_px: 64,
			default_format: 'png',
			profiles: []
		},
		'Stock regression'
	);
	const editor = new ImageEditorController();
	editor.load(design);
	try {
		const screen = await render(Fixture, { editor });
		await screen.getByRole('button', { name: 'Stock media', exact: true }).click();
		await screen.getByRole('textbox', { name: 'Search stock media' }).fill('Own');
		await screen.getByRole('button', { name: 'Search', exact: true }).click();
		await screen.getByRole('button', { name: 'Use', exact: true }).click();
		await expect.poll(() => stock.download.mock.calls.length).toBe(1);
		editor.addPage();
		pending.resolve(new File([blob], 'stock.gif', { type: 'image/gif' }));
		await expect
			.element(screen.getByRole('button', { name: 'Downloading…', exact: true }))
			.not.toBeInTheDocument();
		expect(editor.document!.pages.flatMap((page) => page.layers)).toHaveLength(0);
	} finally {
		pending.resolve(new File([blob], 'stock.gif', { type: 'image/gif' }));
		releaseLocalImageEditorMediaForDesign(design.id);
		await deleteGuestImageEditorDesign(design.id);
	}
});
