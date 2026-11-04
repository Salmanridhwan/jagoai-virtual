import type { components } from "@openpost/api-contract";
import type { QueryFunctionContext } from "@tanstack/query-core";
import { openPostWorkspaceKey } from "./keys";
import { openPostQueryPolicy, queryStaleTime } from "./policies";

export type PublicationBuild = components["schemas"]["Build"];
export interface PublicationBuildQueryAPI {
  get(workspaceId: string, id: string, signal: AbortSignal): Promise<PublicationBuild>;
}
export const publicationBuildKeys = {
  detail: (workspaceId: string, id: string) =>
    openPostWorkspaceKey(workspaceId, "publication-builds", "detail", id),
};
export function publicationBuildQueryOptions(
  api: PublicationBuildQueryAPI,
  workspaceId: string,
  id: string,
) {
  const queryKey = publicationBuildKeys.detail(workspaceId, id);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId && id),
    queryFn: async ({ signal }: QueryFunctionContext<typeof queryKey>) => {
      const build = await api.get(workspaceId, id, signal);
      if (build.workspace_id !== workspaceId)
        throw new Error("These posts belong to another Workspace.");
      return build;
    },
  };
}
