import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { jobStatusQueryOptions } from "@openpost/query-catalog";
import { mobileInboxAPI } from "./api";
import { useInboxActive } from "./lifecycle";
import { jobIsRunning, waitForInboxJobs } from "./jobs";

export function useInboxJob(workspaceId: string, jobId: string | undefined) {
  const active = useInboxActive();
  const queryClient = useQueryClient();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    jobId: string;
    attempt: number;
    needsCheck: boolean;
    error?: string;
  }>();
  const query = useQuery({
    ...jobStatusQueryOptions(mobileInboxAPI, workspaceId, jobId ?? ""),
    enabled: false,
  });
  useEffect(() => {
    if (!active || !jobId || !workspaceId) return;
    const controller = new AbortController();
    void waitForInboxJobs({
      api: mobileInboxAPI,
      queryClient,
      workspaceId,
      jobIds: [jobId],
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted)
          setResult({
            jobId,
            attempt,
            needsCheck: result.outcome === "running" || result.outcome === "check",
          });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setResult({
            jobId,
            attempt,
            needsCheck: true,
            error: error instanceof Error ? error.message : "Could not check delivery.",
          });
      });
    return () => controller.abort();
  }, [workspaceId, jobId, active, attempt, queryClient]);
  const needsCheck =
    !!result && result.jobId === jobId && result.attempt === attempt && result.needsCheck;
  return {
    job: query.data,
    needsCheck,
    checking: active && !!jobId && !needsCheck && (!query.data || jobIsRunning(query.data)),
    error:
      result && result.jobId === jobId && result.attempt === attempt ? result.error : undefined,
    check: () => setAttempt((value) => value + 1),
  };
}
