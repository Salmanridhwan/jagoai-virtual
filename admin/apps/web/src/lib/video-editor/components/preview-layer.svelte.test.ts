import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem } from '../project/types';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { colorPreviewStore } from '../effects/color-preview-store.svelte';
import { scopeSamples } from '../effects/scope-samples.svelte';
import PreviewLayer from './preview-layer.svelte';

const item: TimelineItem = {
	id: 'shape-1',
	trackId: 'visuals',
	from: 0,
	durationInFrames: 60,
	label: 'Shape',
	type: 'shape',
	shapeType: 'rectangle',
	fillColor: '#ff6600'
};

const props = {
	item,
	displayFrame: 0,
	canvasWidth: 640,
	canvasHeight: 360,
	selected: true,
	onselect: () => undefined
};

beforeEach(() => {
	timelineStore.__resetForTesting();
	colorPreviewStore.__resetForTesting();
});

afterEach(() => {
	timelineStore.__resetForTesting();
	colorPreviewStore.__resetForTesting();
	vi.restoreAllMocks();
});

it.each(['parent', 'link', 'expression'] as const)(
	'keeps a paused %s preview current after source edits and sequence replacement',
	async (kind) => {
		const source: TimelineItem = {
			...item,
			id: 'controller',
			type: 'controller',
			transform: { x: 100, y: 0, width: 100, height: 100 }
		};
		const child: TimelineItem = {
			...item,
			transform: { x: 0, y: 0, width: 100, height: 100 }
		};
		if (kind === 'parent') {
			const origin = { x: 0, y: 0, width: 100, height: 100, rotation: 0 };
			child.transformParent = {
				parentItemId: source.id,
				parentReference: origin,
				childLocalReference: origin,
				childWorldReference: origin
			};
		} else if (kind === 'link') {
			child.propertyLinks = [
				{
					type: 'link',
					targetProperty: 'x',
					sourceItemId: source.id,
					sourceProperty: 'x',
					timeOffsetFrames: 0,
					enabled: true
				}
			];
		} else {
			child.expressions = [
				{
					type: 'expression',
					targetProperty: 'x',
					source: 'prop("controller", "x")',
					enabled: true
				}
			];
		}
		timelineStore.setAll({ items: [source, child] });
		const screen = await render(PreviewLayer, { ...props, item: child });
		const layer = screen.container.querySelector<HTMLElement>('[data-preview-item="shape-1"]');
		expect(layer).not.toBeNull();
		await expect.poll(() => layer?.style.left).toBe('65.625%');

		timelineStore._previewUpdateItems([
			{ id: source.id, patch: { transform: { ...source.transform, x: 150 } } }
		]);
		await expect.poll(() => layer?.style.left).toBe('73.4375%');

		timelineStore._updateItems([
			{ id: source.id, patch: { transform: { ...source.transform, x: 200 } } }
		]);
		await expect.poll(() => layer?.style.left).toBe('81.25%');

		timelineStore.setAll({
			items: [{ ...source, transform: { ...source.transform, x: -100 } }, child]
		});
		await expect.poll(() => layer?.style.left).toBe('34.375%');
		expect(timelineStore.currentFrame).toBe(0);
	}
);

it('samples a paused layer only while its scopes are visible', async () => {
	vi.spyOn(performance, 'now').mockReturnValue(1_000);
	const publish = vi.spyOn(scopeSamples, 'publishCanvas');
	const screen = await render(PreviewLayer, props);

	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
	expect(publish).not.toHaveBeenCalled();

	colorPreviewStore.setScopeSampleItemId(item.id);
	await expect.poll(() => publish.mock.calls.length).toBeGreaterThan(0);
	const visiblePublishCount = publish.mock.calls.length;

	colorPreviewStore.setScopeSampleItemId(null);
	await screen.rerender({ ...props, displayFrame: 1 });
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
	expect(publish).toHaveBeenCalledTimes(visiblePublishCount);

	colorPreviewStore.setScopeSampleItemId(item.id);
	await expect.poll(() => publish.mock.calls.length).toBeGreaterThan(visiblePublishCount);
});
