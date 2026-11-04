import type { PublicationBuildRequest, PublicationPostOption } from './client';

export interface IdeateEntry {
	workspaceId: string;
	contextKey: string;
	buildId?: string;
	input?: PublicationBuildRequest;
	apply?: (option: PublicationPostOption, media: Record<string, string[]>) => Promise<void>;
}

// The shell owns the dialog lifetime. Callers supply context, never generation state.
class Ideate {
	open = $state(false);
	entry = $state.raw<IdeateEntry>();
	sequence = $state(0);
	status = $state<'idle' | 'working' | 'ready'>('idle');
	show(entry?: IdeateEntry) {
		if (
			entry &&
			(entry.contextKey !== this.entry?.contextKey || entry.workspaceId !== this.entry?.workspaceId)
		) {
			this.entry = entry;
			this.sequence++;
		} else if (entry) {
			this.entry = { ...this.entry, ...entry };
		}
		this.open = true;
	}
	reset() {
		this.open = false;
		this.entry = undefined;
		this.status = 'idle';
		this.sequence++;
	}
}

export const ideate = new Ideate();
