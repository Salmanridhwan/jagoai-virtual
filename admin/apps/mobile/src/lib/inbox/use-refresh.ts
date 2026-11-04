import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequestIdentityIsCurrent, captureApiRequestIdentity } from "../api/client";
import { mobileInboxAPI, queueInboxRefresh } from "./api";
import { useInboxActive } from "./lifecycle";
import { refreshInbox } from "./refresh";

export function useInboxRefresh({
  workspaceId,
  view,
  viewKey,
  canEdit,
  previousSuccess,
  reloadStored,
}: {
  workspaceId: string;
  view: "chats" | "comments";
  viewKey: string;
  canEdit: boolean;
  previousSuccess?: string;
  reloadStored(): Promise<string | undefined>;
}) {
  const active = useInboxActive();
  const queryClient = useQueryClient();
  const controller = useRef<AbortController | undefined>(undefined);
  const [state, setState] = useState<{
    key: string;
    busy: boolean;
    notice?: string;
    signal?: AbortSignal;
  }>({
    key: viewKey,
    busy: false,
  });
  useEffect(
    () => () => {
      controller.current?.abort();
      controller.current = undefined;
    },
    [workspaceId, viewKey, active, canEdit],
  );
  const refresh = useCallback(async () => {
    if (!active || controller.current) return;
    const run = new AbortController();
    controller.current = run;
    const identity = captureApiRequestIdentity();
    setState({ key: viewKey, busy: true, signal: run.signal });
    try {
      const notice = await refreshInbox({
        canEdit,
        workspaceId,
        previousSuccess,
        api: mobileInboxAPI,
        queryClient,
        signal: run.signal,
        queue: (signal) => queueInboxRefresh(workspaceId, view, signal),
        reloadStored,
      });
      if (!run.signal.aborted && apiRequestIdentityIsCurrent(identity))
        setState({ key: viewKey, busy: false, notice });
    } catch (error) {
      if (!run.signal.aborted && apiRequestIdentityIsCurrent(identity))
        setState({
          key: viewKey,
          busy: false,
          notice:
            error instanceof Error
              ? `Could not confirm collection: ${error.message}. Check the stored sync time before requesting another refresh.`
              : "Could not confirm collection. Showing stored items.",
        });
    } finally {
      if (controller.current === run) controller.current = undefined;
      setState((state) => (state.signal === run.signal ? { ...state, busy: false } : state));
    }
  }, [active, canEdit, workspaceId, view, viewKey, previousSuccess, queryClient, reloadStored]);
  return {
    refresh,
    refreshing: active && state.key === viewKey && state.busy && !state.signal?.aborted,
    notice: state.key === viewKey ? state.notice : undefined,
  };
}
