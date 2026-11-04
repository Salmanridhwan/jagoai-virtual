import createClient from 'openapi-fetch';
import type { paths, components } from './types';
import { feedbackDiagnostics } from '$lib/feedback-diagnostics';
import {
	captureQueryAuthorizationIdentity,
	isSessionUnauthorized,
	settleQueryUnauthorized
} from '$lib/query/authorization-boundary';
import { applyTelemetryRequestHeaders } from '@openpost/telemetry';

// Re-export schema types for convenience
export type User = components['schemas']['UserProfile'];
export type Workspace = components['schemas']['WorkspaceResponse'];
export type SocialAccount = components['schemas']['AccountResponse'];
export type ProviderInfo = components['schemas']['ProviderInfo'];
export type AuthConfiguration = components['schemas']['AuthConfigurationOutputBody'];
export type AccountDeletionImpact = components['schemas']['AccountDeletionImpact'];
export type OIDCProvider = components['schemas']['OIDCProviderSummary'];
export type PublicProfile = components['schemas']['PublicProfileOutputBody'];

export function applyAPIRequestHeaders(headers: Headers): Headers {
	applyTelemetryRequestHeaders(headers);
	return headers;
}

function createApiClient(baseUrl = '/api/v1', fetchImpl?: typeof fetch) {
	const c = createClient<paths>(
		fetchImpl
			? { baseUrl, credentials: 'include', fetch: fetchImpl }
			: { baseUrl, credentials: 'include' }
	);
	c.use({
		async onRequest({ request }) {
			feedbackDiagnostics.recordRequestStart(request);
			applyAPIRequestHeaders(request.headers);
			return request;
		},
		async onResponse({ request, response }) {
			feedbackDiagnostics.recordResponse(request, response);
			return response;
		}
	});
	return c;
}

type APIClient = ReturnType<typeof createApiClient>;
type APIClientMethods = Pick<APIClient, 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'>;

// Settlement is a property of the API client: every request captures the query
// authorization identity before dispatch and settles a rejected session against
// it, so direct mutations cannot leave the app on a stale authenticated shell.
// The boundary keeps the "identity captured before the request" guard, so a 401
// for a superseded identity is a no-op. Action-level 401s, such as a wrong
// password for recent reauthentication, stay with their caller.
type SettledResponseMethod = (...args: never[]) => Promise<{ response: Response }>;

function withQueryAuthorizationSettlement<TMethod extends SettledResponseMethod>(
	invoke: TMethod
): TMethod {
	// SAFETY: the wrapper forwards the original arguments unchanged and returns
	// the original result, so it satisfies the declared method signature.
	return (async (...args: Parameters<TMethod>) => {
		const authorizationIdentity = captureQueryAuthorizationIdentity();
		const result = await invoke(...args);
		if (result.response && isSessionUnauthorized(result.response))
			settleQueryUnauthorized(authorizationIdentity);
		return result;
	}) as TMethod;
}

function settleClientMethods(raw: APIClient): APIClientMethods {
	return {
		GET: withQueryAuthorizationSettlement(raw.GET.bind(raw)),
		POST: withQueryAuthorizationSettlement(raw.POST.bind(raw)),
		PUT: withQueryAuthorizationSettlement(raw.PUT.bind(raw)),
		PATCH: withQueryAuthorizationSettlement(raw.PATCH.bind(raw)),
		DELETE: withQueryAuthorizationSettlement(raw.DELETE.bind(raw))
	};
}

const rawClient = createApiClient();

export const client: APIClientMethods = settleClientMethods(rawClient);

// Test seam with the same settling wiring and an injectable transport, so tests
// can drive a mockserved 401 through a real client method.
export function createSettlingApiClient(
	fetchImpl: typeof fetch,
	baseUrl = 'https://openpost.test/api/v1'
): APIClientMethods {
	return settleClientMethods(createApiClient(baseUrl, fetchImpl));
}
