import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

// Store only a digest and receipt identity, never the message text.
const pending = new Map<string, string>();
export async function inboxSendOperation(
	actorId: string,
	workspaceId: string,
	conversationId: string,
	body: string
) {
	const digest = bytesToHex(sha256(utf8ToBytes(body)));
	const key = `openpost:inbox-send:${actorId}:${workspaceId}:${conversationId}:${digest}`;
	let id = pending.get(key);
	if (!id) {
		try {
			id = sessionStorage.getItem(key) ?? undefined;
		} catch {
			/* Keep retries available when browser storage is disabled. */
		}
	}
	id ??= crypto.randomUUID();
	pending.set(key, id);
	try {
		sessionStorage.setItem(key, id);
	} catch {
		/* The in-memory receipt still protects retries. */
	}

	return {
		id,
		complete() {
			if (pending.get(key) === id) pending.delete(key);
			try {
				sessionStorage.removeItem(key);
			} catch {
				/* No persisted receipt to clear. */
			}
		}
	};
}
