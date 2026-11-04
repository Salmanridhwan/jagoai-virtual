import type { components } from "@openpost/api-contract";
import type { QueryFunctionContext } from "@tanstack/query-core";
import { openPostWorkspaceKey } from "./keys";
import { openPostQueryPolicy, liveQueryStaleTime } from "./policies";

export type PublicationReview = components["schemas"]["PublicationReviewResponse"];
export interface PublicationReviewQueryAPI {
  list(
    workspaceId: string,
    publicationId: string,
    signal: AbortSignal,
  ): Promise<PublicationReview[]>;
}
export const publicationReviewKeys = {
  list: (workspaceId: string, publicationId: string) =>
    openPostWorkspaceKey(workspaceId, "publication-reviews", publicationId),
};
export function publicationReviewsQueryOptions(
  api: PublicationReviewQueryAPI,
  workspaceId: string,
  publicationId: string,
) {
  const queryKey = publicationReviewKeys.list(workspaceId, publicationId);
  return {
    ...openPostQueryPolicy(liveQueryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId && publicationId),
    queryFn: async ({ signal }: QueryFunctionContext<typeof queryKey>) => {
      const rows = await api.list(workspaceId, publicationId, signal);
      if (
        rows.some((row) => row.workspace_id !== workspaceId || row.publication_id !== publicationId)
      )
        throw new Error("Review workspace does not match this post.");
      return rows;
    },
  };
}
