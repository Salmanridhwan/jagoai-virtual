const pendingKey = 'openpost:x-messaging-authorization';
let callback: { state: string; code: string; cancelled: boolean } | undefined;

// Run in the client init hook, before telemetry or route components see the URL.
export function captureXMessagingCallback() {
	if (location.pathname !== '/oauth/x-messaging') return;
	const params = new URLSearchParams(location.search);
	callback = {
		state: params.get('state') ?? '',
		code: params.get('code') ?? '',
		cancelled: params.has('error')
	};
	history.replaceState(history.state, '', location.pathname);
}
export function takeXMessagingCallback() {
	const result = callback;
	callback = undefined;
	return result;
}
export function rememberXMessagingAuthorization(
	url: string,
	actorId: string,
	workspaceId: string,
	accountId: string
) {
	const state = new URL(url).searchParams.get('state');
	if (!state) throw new Error('Missing authorization state');
	// This is a browser-session binding, not an OpenPost credential.
	sessionStorage.setItem(
		pendingKey,
		JSON.stringify({ state, actorId, workspaceId, accountId, expires: Date.now() + 600_000 })
	);
}
export function takeXMessagingAuthorization(state: string, actorId: string) {
	try {
		const raw = sessionStorage.getItem(pendingKey);
		sessionStorage.removeItem(pendingKey);
		if (!raw) return;
		// Parse individual fields so malformed browser storage cannot supply a redirect.
		const value = JSON.parse(raw);
		if (
			value.state !== state ||
			value.actorId !== actorId ||
			!Number.isFinite(value.expires) ||
			value.expires < Date.now()
		)
			return;
		const workspaceId = String(value.workspaceId);
		const accountId = String(value.accountId);
		if (workspaceId !== value.workspaceId || accountId !== value.accountId) return;
		return { workspaceId, accountId };
	} catch {
		return;
	}
}
export function xMessagingSettingsHref(workspaceId = '', accountId = '') {
	const params = new URLSearchParams({ tab: 'accounts' });
	if (workspaceId) params.set('workspace_id', workspaceId);
	if (accountId) params.set('account_id', accountId);
	return `/settings?${params}`;
}
