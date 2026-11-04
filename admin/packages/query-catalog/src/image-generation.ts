import type { components } from "@openpost/api-contract";
import type { QueryFunctionContext } from "@tanstack/query-core";
import { openPostWorkspaceKey } from "./keys";
import { openPostQueryPolicy, queryStaleTime, stableQueryStaleTime } from "./policies";

export type ImageGenerationRun = components["schemas"]["ImageGenerationRun"];
export type ImageGenerationConfig = components["schemas"]["ImageGenerationConfigOutputBody"];

export const imageGenerationKeys = {
  config: (actorId: string) => ["image-generation-config", actorId] as const,
  history: (workspaceId: string, actorId: string, projectId: string) =>
    openPostWorkspaceKey(workspaceId, "image-generations", actorId, projectId),
};

export function imageGenerationConfigOptions(
  read: (signal: AbortSignal) => Promise<ImageGenerationConfig>,
  actorId: string,
) {
  return {
    ...openPostQueryPolicy(stableQueryStaleTime),
    queryKey: imageGenerationKeys.config(actorId),
    enabled: Boolean(actorId),
    queryFn: ({ signal }: QueryFunctionContext) => read(signal),
  };
}

export function imageGenerationHistoryOptions(
  read: (signal: AbortSignal) => Promise<ImageGenerationRun[]>,
  workspaceId: string,
  actorId: string,
  projectId: string,
) {
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey: imageGenerationKeys.history(workspaceId, actorId, projectId),
    enabled: Boolean(workspaceId && actorId && projectId),
    queryFn: ({ signal }: QueryFunctionContext) => read(signal),
  };
}
