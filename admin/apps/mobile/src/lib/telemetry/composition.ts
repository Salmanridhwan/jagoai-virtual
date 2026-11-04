import { api, apiRequestIdentityIsCurrent, captureApiRequestIdentity } from "../api/client";

const claims = new Map<
  string,
  { origin: string; pending: boolean; recorded: boolean; retryAt: number }
>();

export async function recordNativeFirstComposition(
  signal: "text" | "media" | "content_mode",
): Promise<void> {
  const identity = captureApiRequestIdentity();
  if (!identity.workspaceId || !identity.token || !apiRequestIdentityIsCurrent(identity)) return;
  const key = `${identity.serverMutationRevision}:${identity.tokenMutationRevision}:${identity.workspaceId}`;
  const claim = claims.get(key) ?? {
    origin: `native-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    pending: false,
    recorded: false,
    retryAt: 0,
  };
  if (claim.pending || claim.recorded || Date.now() < claim.retryAt) return;
  claims.set(key, claim);
  if (claims.size > 100) claims.delete(claims.keys().next().value!);
  claim.pending = true;
  try {
    const { data, error } = await api().POST("/workspaces/{id}/setup/composition", {
      params: { path: { id: identity.workspaceId } },
      body: { signal, origin_key: claim.origin },
    });
    if (!error && data && apiRequestIdentityIsCurrent(identity)) claim.recorded = true;
    else claim.retryAt = Date.now() + 5000;
  } catch {
    claim.retryAt = Date.now() + 5000;
  } finally {
    claim.pending = false;
  }
}
