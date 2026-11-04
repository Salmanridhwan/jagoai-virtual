interface ThumbnailEntry {
	url?: string;
	owned?: boolean;
}

/** Owns pending thumbnail reads and the object URLs created from their results. */
export class ThumbnailUrlCache {
	#entries = new Map<string, ThumbnailEntry>();
	#revision = -1;
	#disposed = false;

	constructor(
		private readonly load: (id: string) => Promise<Blob | string | null>,
		private readonly publish: (id: string, url: string | null) => void
	) {}

	sync(ids: readonly string[], revision: number): void {
		if (this.#disposed) return;
		const active = new Set(ids);
		for (const [id, entry] of this.#entries) {
			if (revision === this.#revision && active.has(id)) continue;
			if (entry.owned && entry.url) URL.revokeObjectURL(entry.url);
			this.#entries.delete(id);
			this.publish(id, null);
		}
		this.#revision = revision;
		for (const id of active) {
			if (this.#entries.has(id)) continue;
			const entry: ThumbnailEntry = {};
			this.#entries.set(id, entry);
			void this.load(id)
				.then((result) => {
					if (this.#disposed || this.#entries.get(id) !== entry) return;
					if (!result) {
						this.#entries.delete(id);
						return;
					}
					if (result instanceof Blob) {
						entry.owned = true;
						entry.url = URL.createObjectURL(result);
					} else entry.url = result;
					this.publish(id, entry.url);
				})
				.catch(() => {
					// Retry unavailable previews on the next source change or explicit refresh.
					if (this.#entries.get(id) === entry) this.#entries.delete(id);
				});
		}
	}

	dispose(): void {
		this.#disposed = true;
		for (const entry of this.#entries.values()) {
			if (entry.owned && entry.url) URL.revokeObjectURL(entry.url);
		}
		this.#entries.clear();
	}
}
