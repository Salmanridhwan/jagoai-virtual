import { createContext } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';

export class UnsavedChangesContext {
	private sources = new SvelteMap<
		string,
		{ message: string; discardable: boolean; guardWorkspaceSwitch: boolean }
	>();

	get hasChanges(): boolean {
		return this.sources.size > 0;
	}

	get hasBlockingChanges(): boolean {
		for (const source of this.sources.values()) {
			if (!source.discardable) return true;
		}
		return false;
	}

	set(
		key: string,
		dirty: boolean,
		message: string,
		options: { discardable?: boolean; guardWorkspaceSwitch?: boolean } = {}
	): void {
		if (dirty) {
			this.sources.set(key, {
				message,
				discardable: options.discardable ?? true,
				guardWorkspaceSwitch: options.guardWorkspaceSwitch ?? true
			});
		} else this.sources.delete(key);
	}

	clear(key: string): void {
		this.sources.delete(key);
	}

	confirmDiscard(context: 'navigation' | 'workspace-switch' = 'navigation'): boolean {
		const sources = [...this.sources.values()].filter(
			(source) => context !== 'workspace-switch' || source.guardWorkspaceSwitch
		);
		if (sources.length === 0) return true;
		const blockingSource = sources.find((source) => !source.discardable);
		if (blockingSource) {
			window.alert(blockingSource.message);
			return false;
		}
		return window.confirm(sources[0]?.message ?? 'Discard unsaved changes?');
	}
}

export const [getUnsavedChanges, setUnsavedChanges] = createContext<UnsavedChangesContext>();

export function getOptionalUnsavedChanges(): UnsavedChangesContext | null {
	try {
		return getUnsavedChanges();
	} catch {
		return null;
	}
}
