// Model an idle long-poll transport without turning it into immediate empty responses.
export function pendingInboxChanges(signal?: AbortSignal | null): Promise<never> {
	if (!signal) return Promise.reject(new Error('Inbox changes require cancellation'));
	return new Promise((_resolve, reject) => {
		const abort = () => reject(new DOMException('Aborted', 'AbortError'));
		if (signal.aborted) abort();
		else signal.addEventListener('abort', abort, { once: true });
	});
}
