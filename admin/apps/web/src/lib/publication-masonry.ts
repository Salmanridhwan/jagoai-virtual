import './publication-masonry.css';

// Keep the authored DOM and keyboard order while packing cards into shorter columns.
export function publicationMasonry(node: HTMLElement, enabled = true) {
	let stop = () => {};
	function configure(active: boolean) {
		stop();
		if (!active) return;
		const cards = new Set<HTMLElement>();
		const resize = new ResizeObserver((entries) => {
			const gap = Number.parseFloat(getComputedStyle(node).columnGap) || 0;
			for (const entry of entries) {
				if (!(entry.target instanceof HTMLElement)) continue;
				const card = entry.target;
				if (!cards.has(card)) continue;
				const height = entry.borderBoxSize[0]?.blockSize ?? card.getBoundingClientRect().height;
				card.style.gridRowEnd = `span ${Math.ceil(height + gap)}`;
			}
		});
		function reconcile() {
			for (const card of cards) {
				if (card.parentElement === node) continue;
				resize.unobserve(card);
				cards.delete(card);
			}
			for (const child of node.children) {
				if (!(child instanceof HTMLElement) || cards.has(child)) continue;
				cards.add(child);
				resize.observe(child, { box: 'border-box' });
			}
		}
		node.classList.add('publication-masonry-ready');
		const mutations = new MutationObserver(reconcile);
		mutations.observe(node, { childList: true });
		reconcile();
		stop = () => {
			resize.disconnect();
			mutations.disconnect();
			node.classList.remove('publication-masonry-ready');
			for (const card of cards) card.style.removeProperty('grid-row-end');
			cards.clear();
		};
	}
	configure(enabled);
	return { update: configure, destroy: () => stop() };
}
