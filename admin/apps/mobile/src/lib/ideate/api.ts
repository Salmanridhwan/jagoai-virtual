import { createMobileQueryAPI } from "../query-api";
import type { components } from "@openpost/api-contract";
import { throwIfAborted } from "@openpost/query-catalog";
import {
  api,
  captureApiRequestIdentity,
  apiRequestIdentityIsCurrent,
  errorMessage,
  settleApiUnauthorized,
  type Api,
} from "../api/client";

export type IdeateBuild = components["schemas"]["Build"];
export type PostOption = components["schemas"]["PostOption"];
export type BuildRequest = components["schemas"]["CreatePublicationBuildBody"];

export function buildIsRunning(build?: IdeateBuild): boolean {
  return build?.state === "queued" || build?.state === "building";
}

export function createIdeateAPI(client: Api = api()) {
  const reads = createMobileQueryAPI(() => client);
  async function receive<T>(
    request: () => Promise<{ data?: T; error?: unknown; response: Response }>,
    fallback: string,
  ): Promise<T> {
    const identity = captureApiRequestIdentity();
    const result = await request();
    await settleApiUnauthorized(identity, result.response);
    if (!apiRequestIdentityIsCurrent(identity))
      throw new Error("Your Workspace or session changed. Try again.");
    if (result.error || result.data === undefined)
      throw new Error(await errorMessage(result.response, fallback, result.error));
    return result.data;
  }
  return {
    create(request: BuildRequest, key: string, signal: AbortSignal) {
      return receive(
        () =>
          client.POST("/publication-builds", {
            signal,
            params: { header: { "Idempotency-Key": key } },
            body: request,
          }),
        "Could not generate posts",
      );
    },
    async get(workspaceId: string, id: string, signal: AbortSignal) {
      const identity = captureApiRequestIdentity();
      const build = await reads.getPublicationBuild(workspaceId, id, signal);
      if (!apiRequestIdentityIsCurrent(identity))
        throw new Error("Your Workspace or session changed. Try again.");
      throwIfAborted(signal);
      if (build.workspace_id !== workspaceId)
        throw new Error("These posts belong to another Workspace.");
      if (build.state === "ready" && build.result?.options?.length !== 4)
        throw new Error("This build does not contain four complete posts.");
      return build;
    },
    retry(id: string, signal: AbortSignal) {
      return receive(
        () => client.POST("/publication-builds/{id}/retry", { signal, params: { path: { id } } }),
        "Could not retry generation",
      );
    },
    cancel(id: string, signal: AbortSignal) {
      return receive(
        () => client.POST("/publication-builds/{id}/cancel", { signal, params: { path: { id } } }),
        "Could not cancel generation",
      );
    },
    commit(
      id: string,
      revision: number,
      option: PostOption,
      media: { account_id: string; media_id: string }[],
      signal: AbortSignal,
    ) {
      return receive(
        () =>
          client.POST("/publication-builds/{id}/options/{option_id}/commit", {
            signal,
            params: { path: { id, option_id: option.id } },
            body: {
              expected_revision: revision,
              media,
              edits: (option.destinations ?? []).map((destination) => ({
                account_id: destination.account_id,
                segments: destination.segments,
                document: destination.media.document,
              })),
            },
          }),
        "Could not create this draft",
      );
    },
    async listVoiceProfiles(workspaceId: string, signal: AbortSignal) {
      const identity = captureApiRequestIdentity();
      const voices = await reads.listVoiceProfiles(workspaceId, signal);
      throwIfAborted(signal);
      if (!apiRequestIdentityIsCurrent(identity))
        throw new Error("Your Workspace or session changed. Try again.");
      return voices;
    },
  };
}
