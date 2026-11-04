import { expect, it } from 'vitest';
import { fittedImageSettings } from './image-settings';

it('keeps attachment metadata and maps image positions into centered padding and back', () => {
	const authored = {
		alt_text: '',
		user_tags: '[{"username":"person","x":0,"y":1}]',
		product_tags: '[{"product_id":"product"}]',
		focal_point: '-1,1',
		thumbnail_timestamp_ms: 0
	};
	// A 200x100 image in a 100x100 square occupies its middle 50 vertical pixels.
	const fitted = fittedImageSettings(
		authored,
		{ width: 200, height: 100 },
		{ width: 100, height: 100 }
	);
	expect(JSON.parse(String(fitted.user_tags))).toEqual([{ username: 'person', x: 0, y: 0.75 }]);
	expect({ ...fitted, user_tags: authored.user_tags }).toEqual({
		...authored,
		focal_point: '-1,0.5'
	});
	const restored = fittedImageSettings(
		fitted,
		{ width: 200, height: 100 },
		{ width: 100, height: 100 },
		true
	);
	expect(JSON.parse(String(restored.user_tags))).toEqual(JSON.parse(authored.user_tags));
	expect({ ...restored, user_tags: authored.user_tags }).toEqual(authored);
});
