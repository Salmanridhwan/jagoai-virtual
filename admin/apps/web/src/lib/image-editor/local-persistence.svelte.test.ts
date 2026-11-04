import { afterEach, expect, it } from 'vitest';
import { blankImageEditorDocument } from './document';
import { localImageEditorMediaURL, releaseLocalImageEditorMediaForDesign } from './local-media-url';
import {
	listGuestImageEditorDesigns,
	createGuestImageEditorDesign,
	storeGuestImageEditorMedia,
	saveGuestImageEditorDesign,
	loadGuestImageEditorDesign,
	deleteGuestImageEditorDesign,
	warmGuestImageEditorPreviewMedia,
	openImageEditorDatabase,
	type LocalImageEditorDesign
} from './local-persistence';

async function replaceDesigns(records: LocalImageEditorDesign[]): Promise<void> {
	const db = await openImageEditorDatabase();
	try {
		await new Promise<void>((resolve, reject) => {
			const transaction = db.transaction('guest-designs', 'readwrite');
			const store = transaction.objectStore('guest-designs');
			store.clear();
			for (const record of records) store.put(record);
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
		});
	} finally {
		db.close();
	}
}

afterEach(() => replaceDesigns([]));

it('lists recent local designs with stable timestamp ties and load-more ordering', async () => {
	const document = blankImageEditorDocument({
		key: 'custom',
		name: 'Custom',
		width_px: 800,
		height_px: 600,
		default_format: 'png',
		profiles: []
	});
	const records = [
		...Array.from({ length: 8 }, (_, index) => ({
			id: `new-${index}`,
			updated_at: `2026-10-${20 + index}T00:00:00.000Z`
		})),
		...['f', 'b', 'd', 'a', 'e', 'c'].map((id) => ({
			id: `tied-${id}`,
			updated_at: '2026-10-10T00:00:00.000Z'
		})),
		{ id: 'old', updated_at: '2026-01-01T00:00:00.000Z' }
	].map((record) => ({ ...record, revision: 1, created_at: record.updated_at, document }));
	await replaceDesigns(records);
	const latest = ['new-7', 'new-6', 'new-5', 'new-4', 'new-3', 'new-2', 'new-1', 'new-0'];
	const first = await listGuestImageEditorDesigns();
	expect(first.map((record) => record.id)).toEqual([
		...latest,
		'tied-a',
		'tied-b',
		'tied-c',
		'tied-d'
	]);
	expect(first[0].document.width_px).toBe(800);
	expect((await listGuestImageEditorDesigns(24)).map((record) => record.id)).toEqual([
		...latest,
		'tied-a',
		'tied-b',
		'tied-c',
		'tied-d',
		'tied-e',
		'tied-f',
		'old'
	]);
	expect((await listGuestImageEditorDesigns(1)).map((record) => record.id)).toEqual(['new-7']);
	expect(await listGuestImageEditorDesigns(0)).toEqual([]);
	await replaceDesigns([]);
	expect(await listGuestImageEditorDesigns()).toEqual([]);
});

it('loads only the cover assets for the gallery and loads later pages when the design opens', async () => {
	const created = await createGuestImageEditorDesign(
		{
			key: 'custom',
			name: 'Custom',
			width_px: 800,
			height_px: 600,
			default_format: 'png',
			profiles: []
		},
		'Two pages'
	);
	try {
		const canvas = new OffscreenCanvas(2, 2);
		const context = canvas.getContext('2d')!;
		context.fillStyle = '#ff0000';
		context.fillRect(0, 0, 2, 2);
		const blob = await canvas.convertToBlob({ type: 'image/png' });
		const cover = await storeGuestImageEditorMedia(
			created.id,
			new File([blob], 'cover.png', { type: 'image/png' })
		);
		const later = await storeGuestImageEditorMedia(
			created.id,
			new File([blob], 'later.png', { type: 'image/png' })
		);
		const document = created.document;
		document.pages = [cover, later].map((media, index) => ({
			...document.pages[0],
			id: `page-${index}`,
			name: `Page ${index + 1}`,
			background: { type: 'image', opacity: 1, image: { media_id: media.id, fit: 'cover' } }
		}));
		await saveGuestImageEditorDesign(created.id, document);
		releaseLocalImageEditorMediaForDesign(created.id);
		expect(await warmGuestImageEditorPreviewMedia(document)).toEqual([]);
		expect(localImageEditorMediaURL(cover.id)).toMatch(/^blob:/);
		expect(localImageEditorMediaURL(later.id)).toBeUndefined();
		const opened = await loadGuestImageEditorDesign(created.id);
		expect(opened.document.pages[1].background?.image?.media_id).toBe(later.id);
		expect(localImageEditorMediaURL(later.id)).toMatch(/^blob:/);
	} finally {
		await deleteGuestImageEditorDesign(created.id);
	}
});
