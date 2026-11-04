import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { useIsFocused } from "expo-router/react-navigation";
import { useFocusEffect } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { startInboxUpdates } from "@openpost/query-catalog";
import { useWorkspaceId } from "../queries";
import { getQueryOnline, subscribeQueryOnline } from "../query-lifecycle";
import { nativeInboxTransport, type InboxView } from "./api";
import { inboxClientId } from "./storage";

export function useInboxUpdates(view: InboxView, conversationId?: string) {
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  useEffect(() => {
    if (!workspaceId || !focused) return;
    let stop: (() => void) | undefined;
    const update = () => {
      stop?.();
      stop = undefined;
      if (AppState.currentState === "active" && getQueryOnline()) {
        const controller = new AbortController();
        const stopUpdates = startInboxUpdates({
          api: {
            ...nativeInboxTransport,
            async inboxChanges(...args) {
              const page = await nativeInboxTransport.inboxChanges(...args);
              setError(null);
              return page;
            },
          },
          workspaceId,
          view,
          conversationId,
          queryClient,
          clientId: inboxClientId(),
          signal: controller.signal,
          onError: setError,
        });
        stop = () => {
          controller.abort();
          stopUpdates();
        };
      }
    };
    update();
    const listener = AppState.addEventListener("change", update);
    const unsubscribe = subscribeQueryOnline(update);
    return () => {
      listener.remove();
      unsubscribe();
      stop?.();
    };
  }, [workspaceId, focused, view, conversationId, queryClient]);
  return error;
}

function subscribeActive(listener: () => void) {
  const subscription = AppState.addEventListener("change", listener);
  const offline = subscribeQueryOnline(listener);
  return () => {
    subscription.remove();
    offline();
  };
}
export function useInboxActive() {
  const focused = useIsFocused();
  return (
    useSyncExternalStore(
      subscribeActive,
      () => AppState.currentState === "active" && getQueryOnline(),
      () => false,
    ) && focused
  );
}
