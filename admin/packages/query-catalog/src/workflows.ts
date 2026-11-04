import type { QueryClient, QueryFunctionContext } from "@tanstack/query-core";
import { throwIfAborted } from "./caller-abort";
import type { components } from "@openpost/api-contract";
import { openPostWorkspaceKey } from "./keys";
import { openPostQueryPolicy, queryStaleTime } from "./policies";

export type Workflow = components["schemas"]["Workflow"];
export type WorkflowRun = components["schemas"]["WorkflowRun"];
export type WorkflowRunSummary = components["schemas"]["WorkflowRunSummary"];
export interface WorkflowRunSummaryQueryAPI {
  runSummaries(
    workspaceID: string,
    workflowID: string,
    signal: AbortSignal,
  ): Promise<WorkflowRunSummary[]>;
}
export type WorkflowConnection = components["schemas"]["WorkflowConnection"];
export interface WorkflowQueryAPI {
  list(workspaceID: string, signal: AbortSignal): Promise<Workflow[]>;
  get(workspaceID: string, id: string, signal: AbortSignal): Promise<Workflow>;
  runs(workspaceID: string, workflowID: string, signal: AbortSignal): Promise<WorkflowRun[]>;
  run(workspaceID: string, id: string, signal: AbortSignal): Promise<WorkflowRun>;
  connections(workspaceID: string, signal: AbortSignal): Promise<WorkflowConnection[]>;
}
export const workflowQueryKeys = {
  all: (ws: string) => openPostWorkspaceKey(ws, "workflows"),
  list: (ws: string) => openPostWorkspaceKey(ws, "workflows", "list"),
  detail: (ws: string, id: string) => openPostWorkspaceKey(ws, "workflows", "detail", id),
  runs: (ws: string, id = "") => openPostWorkspaceKey(ws, "workflows", "runs", id),
  runSummaries: (ws: string, id = "") =>
    openPostWorkspaceKey(ws, "workflows", "runs", id, "summaries"),
  run: (ws: string, id: string) => openPostWorkspaceKey(ws, "workflows", "run", id),
  connections: (ws: string) => openPostWorkspaceKey(ws, "workflows", "connections"),
};
export function workflowsQueryOptions(api: WorkflowQueryAPI, ws: string) {
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey: workflowQueryKeys.list(ws),
    enabled: Boolean(ws),
    queryFn: ({ signal }: { signal: AbortSignal }) => api.list(ws, signal),
  };
}
export function workflowQueryOptions(api: WorkflowQueryAPI, ws: string, id: string) {
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey: workflowQueryKeys.detail(ws, id),
    enabled: Boolean(ws && id),
    queryFn: ({ signal }: { signal: AbortSignal }) => api.get(ws, id, signal),
  };
}
export function workflowRunsQueryOptions(api: WorkflowQueryAPI, ws: string, id = "") {
  const queryKey = workflowQueryKeys.runs(ws, id);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(ws),
    queryFn: async ({ client, signal }: QueryFunctionContext<typeof queryKey>) => {
      const runs = await api.runs(ws, id, signal);
      throwIfAborted(signal);
      return runs.map((run) => reconcileWorkflowRun(client, ws, run));
    },
    refetchInterval: 15000,
  };
}
export function workflowRunSummariesQueryOptions(
  api: WorkflowRunSummaryQueryAPI,
  ws: string,
  id = "",
) {
  const queryKey = workflowQueryKeys.runSummaries(ws, id);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(ws),
    queryFn: async ({ client, signal }: QueryFunctionContext<typeof queryKey>) => {
      const runs = await api.runSummaries(ws, id, signal);
      throwIfAborted(signal);
      return runs.map((run) => reconcileWorkflowRunSummary(client, ws, run));
    },
    refetchInterval: 15000,
  };
}

export function workflowRunQueryOptions(api: WorkflowQueryAPI, ws: string, id: string) {
  const queryKey = workflowQueryKeys.run(ws, id);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(ws && id),
    queryFn: async ({ client, signal }: QueryFunctionContext<typeof queryKey>) => {
      const run = await api.run(ws, id, signal);
      throwIfAborted(signal);
      return reconcileWorkflowRun(client, ws, run);
    },
  };
}
export function workflowConnectionsQueryOptions(api: WorkflowQueryAPI, ws: string) {
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey: workflowQueryKeys.connections(ws),
    enabled: Boolean(ws),
    queryFn: ({ signal }: { signal: AbortSignal }) => api.connections(ws, signal),
  };
}

function reconcileWorkflowRun(client: QueryClient, workspaceID: string, incoming: WorkflowRun) {
  if (incoming.workspace_id !== workspaceID) return incoming;
  const detailKey = workflowQueryKeys.run(workspaceID, incoming.id);
  const current = client.getQueryData<WorkflowRun>(detailKey);
  // Durable state/step writes increment revision. Equal-revision reads remain authoritative, including lease acquisition changing queued to running.
  const run =
    current?.workspace_id === workspaceID &&
    current.workflow_id === incoming.workflow_id &&
    current.revision > incoming.revision
      ? current
      : incoming;
  client.setQueryData(detailKey, run);
  for (const key of [
    workflowQueryKeys.runs(workspaceID),
    workflowQueryKeys.runs(workspaceID, run.workflow_id),
  ]) {
    client.setQueryData<WorkflowRun[]>(key, (runs) =>
      runs?.map((listed) =>
        listed.id === run.id &&
        listed.workspace_id === workspaceID &&
        listed.workflow_id === run.workflow_id &&
        listed.revision <= run.revision
          ? run
          : listed,
      ),
    );
  }
  updateWorkflowRunSummaries(client, workspaceID, summarizeWorkflowRun(run));
  const summary = cachedWorkflowRunSummary(client, workspaceID, run);
  if (summary && summary.revision > run.revision) {
    // A late full-list response may seed an older snapshot. Keep its complete
    // payload available, but require a fresh detail read when it is inspected.
    void client.invalidateQueries({ queryKey: detailKey, exact: true });
  }
  return run;
}

function summarizeWorkflowRun(run: WorkflowRun): WorkflowRunSummary {
  const { source: _source, steps, ...summary } = run;
  return { ...summary, steps: (steps ?? []).map(({ step_id, state }) => ({ step_id, state })) };
}

function summaryKeys(workspaceID: string, workflowID: string) {
  return [
    workflowQueryKeys.runSummaries(workspaceID),
    workflowQueryKeys.runSummaries(workspaceID, workflowID),
  ];
}

function sameRun(a: WorkflowRunSummary, b: WorkflowRunSummary) {
  return a.id === b.id && a.workspace_id === b.workspace_id && a.workflow_id === b.workflow_id;
}

function cachedWorkflowRunSummary(
  client: QueryClient,
  workspaceID: string,
  run: WorkflowRunSummary,
) {
  let latest: WorkflowRunSummary | undefined;
  for (const key of summaryKeys(workspaceID, run.workflow_id)) {
    const cached = client
      .getQueryData<WorkflowRunSummary[]>(key)
      ?.find((listed) => sameRun(listed, run));
    if (cached && (!latest || cached.revision > latest.revision)) latest = cached;
  }
  return latest;
}

function updateWorkflowRunSummaries(
  client: QueryClient,
  workspaceID: string,
  run: WorkflowRunSummary,
) {
  for (const key of summaryKeys(workspaceID, run.workflow_id)) {
    client.setQueryData<WorkflowRunSummary[]>(key, (runs) =>
      runs?.map((listed) =>
        sameRun(listed, run) && listed.revision <= run.revision ? run : listed,
      ),
    );
  }
}

function reconcileWorkflowRunSummary(
  client: QueryClient,
  workspaceID: string,
  incoming: WorkflowRunSummary,
) {
  if (incoming.workspace_id !== workspaceID) return incoming;
  const detailKey = workflowQueryKeys.run(workspaceID, incoming.id);
  const detail = client.getQueryData<WorkflowRun>(detailKey);
  const previous = cachedWorkflowRunSummary(client, workspaceID, incoming);
  let run = previous && previous.revision > incoming.revision ? previous : incoming;
  if (detail && sameRun(detail, run)) {
    if (detail.revision > run.revision) run = summarizeWorkflowRun(detail);
    else if (detail.revision < run.revision || detail.state !== run.state) {
      // A summary cannot replace a full snapshot. Mark inactive details stale
      // and refresh active inspectors when their recorded execution advances.
      void client.invalidateQueries({ queryKey: detailKey, exact: true });
    }
  } else if (
    !detail &&
    (!previous || previous.revision < run.revision || previous.state !== run.state) &&
    client.getQueryState(detailKey)?.fetchStatus === "fetching"
  ) {
    // Invalidation deduplicates a cold fetch instead of cancelling it. Reset
    // that older request before refetching active inspectors; unchanged summary
    // polls must not continually restart a slow request.
    void client.resetQueries({ queryKey: detailKey, exact: true });
  }
  updateWorkflowRunSummaries(client, workspaceID, run);
  return run;
}
