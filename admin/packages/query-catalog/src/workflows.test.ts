import { QueryClient, QueryObserver } from "@tanstack/query-core";
import { expect, it, vi } from "vitest";
import {
  workflowRunQueryOptions,
  workflowRunSummariesQueryOptions,
  type WorkflowRunSummary,
  workflowRunsQueryOptions,
  workflowQueryKeys,
  type WorkflowQueryAPI,
  type WorkflowRun,
} from "./workflows";

function run(revision: number, state: string): WorkflowRun {
  return {
    id: "run",
    workspace_id: "workspace-a",
    workflow_id: "workflow",
    workflow_name: "Audit",
    workflow_revision: 1,
    revision,
    mode: "live",
    state,
    definition: { schema: 1, source: { kind: "manual" }, steps: [] },
    source: {},
    steps: [],
    created_at: "2026-10-02T00:00:00Z",
    updated_at: "2026-10-02T00:01:00Z",
  };
}
function api(initial: WorkflowRun): WorkflowQueryAPI {
  return {
    list: vi.fn(),
    get: vi.fn(),
    connections: vi.fn(),
    runs: vi.fn(async () => [initial]),
    run: vi.fn(async () => initial),
  };
}
it("reconciles selected run revisions into both owning lists without changing another Workspace", async () => {
  const client = new QueryClient();
  const queued = run(1, "queued");
  const transport = api(queued);
  const workflowList = workflowQueryKeys.runs("workspace-a", "workflow");
  const allList = workflowQueryKeys.runs("workspace-a");
  const otherList = workflowQueryKeys.runs("workspace-b", "workflow");
  await client.fetchQuery(workflowRunsQueryOptions(transport, "workspace-a", "workflow"));
  await client.fetchQuery(workflowRunsQueryOptions(transport, "workspace-a"));
  client.setQueryData(otherList, [queued]);
  const waiting = run(2, "waiting");
  vi.mocked(transport.run).mockResolvedValue(waiting);
  await client.fetchQuery({
    ...workflowRunQueryOptions(transport, "workspace-a", "run"),
    staleTime: 0,
  });
  expect(client.getQueryData(workflowList)).toEqual([waiting]);
  expect(client.getQueryData(allList)).toEqual([waiting]);
  expect(client.getQueryData(otherList)).toEqual([queued]);
  const approved = run(3, "queued");
  vi.mocked(transport.run).mockResolvedValue(approved);
  await client.fetchQuery({
    ...workflowRunQueryOptions(transport, "workspace-a", "run"),
    staleTime: 0,
  });
  expect(client.getQueryData(workflowList)).toEqual([approved]);
  expect(client.getQueryData(allList)).toEqual([approved]);
  const running = run(3, "running");
  vi.mocked(transport.run).mockResolvedValue(running);
  await client.fetchQuery({
    ...workflowRunQueryOptions(transport, "workspace-a", "run"),
    staleTime: 0,
  });
  expect(client.getQueryData(workflowList)).toEqual([running]);
  client.clear();
});
it("does not regress newer detail from a late list but accepts a newer authoritative list", async () => {
  const client = new QueryClient();
  const transport = api(run(1, "queued"));
  let resolveList: (runs: WorkflowRun[]) => void = () => {
    throw new Error("List has not started");
  };
  vi.mocked(transport.runs).mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveList = resolve;
      }),
  );
  const pending = client.fetchQuery(workflowRunsQueryOptions(transport, "workspace-a", "workflow"));
  await vi.waitFor(() => expect(transport.runs).toHaveBeenCalledOnce());
  const waiting = run(3, "waiting");
  vi.mocked(transport.run).mockResolvedValue(waiting);
  await client.fetchQuery(workflowRunQueryOptions(transport, "workspace-a", "run"));
  resolveList([run(1, "queued")]);
  expect(await pending).toEqual([waiting]);
  const newer = run(4, "succeeded");
  vi.mocked(transport.runs).mockResolvedValue([newer]);
  await client.fetchQuery({
    ...workflowRunsQueryOptions(transport, "workspace-a", "workflow"),
    staleTime: 0,
  });
  expect(client.getQueryData(workflowQueryKeys.run("workspace-a", "run"))).toEqual(newer);
  vi.mocked(transport.run).mockResolvedValue(run(2, "waiting"));
  expect(
    await client.fetchQuery({
      ...workflowRunQueryOptions(transport, "workspace-a", "run"),
      staleTime: 0,
    }),
  ).toEqual(newer);
  client.clear();
});

function summary(revision: number, state: string): WorkflowRunSummary {
  return {
    id: "run",
    workspace_id: "workspace-a",
    workflow_id: "workflow",
    workflow_name: "Audit",
    workflow_revision: 1,
    revision,
    mode: "live",
    state,
    definition: { schema: 1, source: { kind: "manual" }, steps: [] },
    steps: [{ step_id: "draft", state: "succeeded" }],
    created_at: "2026-10-02T00:00:00Z",
    updated_at: "2026-10-02T00:01:00Z",
  };
}

it("keeps list summaries separate from complete run snapshots and invalidates changed details", async () => {
  const client = new QueryClient();
  const transport = { runSummaries: vi.fn(async () => [summary(2, "waiting")]) };
  const options = workflowRunSummariesQueryOptions(transport, "workspace-a");
  await client.fetchQuery(options);
  const detailKey = workflowQueryKeys.run("workspace-a", "run");
  expect(client.getQueryData(detailKey)).toBeUndefined();
  const complete = { ...run(2, "waiting"), source: { body: "Preserved source" } };
  client.setQueryData(detailKey, complete);
  const advanced = summary(3, "succeeded");
  transport.runSummaries.mockResolvedValue([advanced]);
  expect(await client.fetchQuery({ ...options, staleTime: 0 })).toEqual([advanced]);
  expect(client.getQueryData(detailKey)).toEqual(complete);
  expect(client.getQueryState(detailKey)?.isInvalidated).toBe(true);
  client.clear();
});

it("refreshes an active inspector for equal-revision queued to running changes", async () => {
  const client = new QueryClient();
  const complete = { ...run(2, "queued"), source: { body: "Original" } };
  const transport = api(complete);
  const observer = new QueryObserver(
    client,
    workflowRunQueryOptions(transport, "workspace-a", "run"),
  );
  const unsubscribe = observer.subscribe(() => {});
  await vi.waitFor(() => expect(observer.getCurrentResult().data).toEqual(complete));
  const executing = { ...complete, state: "running" };
  vi.mocked(transport.run).mockResolvedValue(executing);
  await client.fetchQuery(
    workflowRunSummariesQueryOptions(
      { runSummaries: async () => [summary(2, "running")] },
      "workspace-a",
    ),
  );
  await vi.waitFor(() => expect(observer.getCurrentResult().data).toEqual(executing));
  expect(transport.run).toHaveBeenCalledTimes(2);
  unsubscribe();
  client.clear();
});

it("restarts a cold inspector when a newer summary arrives before its full snapshot", async () => {
  const client = new QueryClient();
  const older = { ...run(2, "cancelled"), source: { body: "Original source" } };
  const newer = {
    ...older,
    revision: 3,
    steps: [
      {
        step_id: "draft",
        state: "succeeded",
        kind: "create_draft",
        name: "Draft",
        inputs: { body: "Retained input" },
        output: { body: "Completed output" },
        started_at: "2026-10-02T00:00:00Z",
      },
    ],
  };
  const transport = api(newer);
  let finishOlder: (value: WorkflowRun) => void = () => {
    throw new Error("Request has not started");
  };
  vi.mocked(transport.run).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOlder = resolve;
      }),
  );
  const observer = new QueryObserver(
    client,
    workflowRunQueryOptions(transport, "workspace-a", "run"),
  );
  const snapshots: WorkflowRun[] = [];
  const unsubscribe = observer.subscribe(({ data }) => {
    if (data) snapshots.push(data);
  });
  try {
    await vi.waitFor(() => expect(transport.run).toHaveBeenCalledOnce());
    await client.fetchQuery(
      workflowRunSummariesQueryOptions(
        { runSummaries: async () => [summary(3, "cancelled")] },
        "workspace-a",
      ),
    );
    finishOlder(older);
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toEqual(newer));
    expect(transport.run).toHaveBeenCalledTimes(2);
    expect(snapshots.every((snapshot) => snapshot.revision === 3)).toBe(true);
    expect(client.getQueryData(workflowQueryKeys.runSummaries("workspace-a"))).toEqual([
      summary(3, "cancelled"),
    ]);
  } finally {
    unsubscribe();
    client.clear();
  }
});

it("does not regress newer run lists or leak payloads when a late summary or detail completes", async () => {
  const client = new QueryClient();
  const allKey = workflowQueryKeys.runSummaries("workspace-a");
  const filteredKey = workflowQueryKeys.runSummaries("workspace-a", "workflow");
  const otherKey = workflowQueryKeys.runSummaries("workspace-b");
  const newer = summary(3, "waiting");
  const other = { ...newer, workspace_id: "workspace-b" };
  client.setQueryData(allKey, [newer]);
  client.setQueryData(otherKey, [other]);
  await client.fetchQuery(
    workflowRunSummariesQueryOptions(
      { runSummaries: async () => [summary(1, "queued")] },
      "workspace-a",
      "workflow",
    ),
  );
  expect(client.getQueryData(filteredKey)).toEqual([newer]);
  expect(client.getQueryData(allKey)).toEqual([newer]);
  const finished = {
    ...run(4, "succeeded"),
    source: { secret: "Do not copy to summary" },
    steps: [
      {
        step_id: "draft",
        state: "succeeded",
        kind: "create_draft",
        name: "Draft",
        inputs: { body: "large input" },
        output: { body: "large output" },
        started_at: "2026-10-02T00:00:00Z",
      },
    ],
  };
  await client.fetchQuery(workflowRunQueryOptions(api(finished), "workspace-a", "run"));
  for (const key of [allKey, filteredKey]) {
    const data = client.getQueryData<WorkflowRunSummary[]>(key);
    expect(data?.[0]?.revision).toBe(4);
    expect(data?.[0]?.steps).toEqual([{ step_id: "draft", state: "succeeded" }]);
    expect(data?.[0]).not.toHaveProperty("source");
  }
  expect(client.getQueryData(otherKey)).toEqual([other]);
  expect(
    await client.fetchQuery({
      ...workflowRunSummariesQueryOptions(
        { runSummaries: async () => [summary(2, "running")] },
        "workspace-a",
      ),
      staleTime: 0,
    }),
  ).toEqual(client.getQueryData(filteredKey));
  client.clear();
});

it("refreshes an inactive detail seeded by a full list older than the known summary", async () => {
  const client = new QueryClient();
  const older = run(2, "cancelled");
  const newer = { ...run(3, "cancelled"), source: { body: "Complete snapshot" } };
  const transport = api(newer);
  let finishList: (value: WorkflowRun[]) => void = () => {
    throw new Error("Request has not started");
  };
  vi.mocked(transport.runs).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishList = resolve;
      }),
  );
  try {
    const pending = client.fetchQuery(workflowRunsQueryOptions(transport, "workspace-a"));
    await vi.waitFor(() => expect(transport.runs).toHaveBeenCalledOnce());
    await client.fetchQuery(
      workflowRunSummariesQueryOptions(
        { runSummaries: async () => [summary(3, "cancelled")] },
        "workspace-a",
      ),
    );
    finishList([older]);
    await pending;
    const opened = await client.fetchQuery(
      workflowRunQueryOptions(transport, "workspace-a", "run"),
    );
    expect(opened).toEqual(newer);
    expect(transport.run).toHaveBeenCalledOnce();
  } finally {
    client.clear();
  }
});

it("keeps an in-flight cold snapshot when summary polling has not advanced", async () => {
  const client = new QueryClient();
  const current = run(3, "cancelled");
  const transport = api(current);
  const summaries = workflowRunSummariesQueryOptions(
    { runSummaries: async () => [summary(3, "cancelled")] },
    "workspace-a",
  );
  await client.fetchQuery(summaries);
  let finish: (value: WorkflowRun) => void = () => {
    throw new Error("Request has not started");
  };
  vi.mocked(transport.run).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const observer = new QueryObserver(
    client,
    workflowRunQueryOptions(transport, "workspace-a", "run"),
  );
  const unsubscribe = observer.subscribe(() => {});
  try {
    await vi.waitFor(() => expect(transport.run).toHaveBeenCalledOnce());
    await client.fetchQuery({ ...summaries, staleTime: 0 });
    finish(current);
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toEqual(current));
    expect(transport.run).toHaveBeenCalledOnce();
  } finally {
    unsubscribe();
    client.clear();
  }
});

it("discards a cancelled summary response without invalidating or seeding caches", async () => {
  const client = new QueryClient();
  const detailKey = workflowQueryKeys.run("workspace-a", "run");
  const complete = run(1, "queued");
  client.setQueryData(detailKey, complete);
  let resolve: (value: WorkflowRunSummary[]) => void = () => {
    throw new Error("request not started");
  };
  const transport = {
    runSummaries: vi.fn(
      () =>
        new Promise<WorkflowRunSummary[]>((done) => {
          resolve = done;
        }),
    ),
  };
  const options = workflowRunSummariesQueryOptions(transport, "workspace-a");
  const pending = client.fetchQuery(options).catch(() => undefined);
  await vi.waitFor(() => expect(transport.runSummaries).toHaveBeenCalledOnce());
  await client.cancelQueries({ queryKey: options.queryKey });
  resolve([summary(5, "succeeded")]);
  await pending;
  await Promise.resolve();
  expect(client.getQueryData(detailKey)).toEqual(complete);
  expect(client.getQueryState(detailKey)?.isInvalidated).toBe(false);
  expect(client.getQueryData(options.queryKey)).toBeUndefined();
  client.clear();
});
