import { openPostBootstrapQueryKeys, type AppBootstrap } from "@openpost/query-catalog";
import { useSegments } from "expo-router";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { Alert, AppState } from "react-native";
import { api } from "@/lib/api/client";
import { getToken, subscribeToken } from "@/lib/api/token-store";
import { getServer, subscribeServer } from "@/lib/server";
import { queryClient } from "@/lib/query-client";
import { nativeTelemetry } from "@/lib/telemetry";

export function NativeTelemetryRuntime({ ready }: { ready: boolean }) {
  const server = useSyncExternalStore(subscribeServer, getServer);
  const token = useSyncExternalStore(subscribeToken, getToken);
  const preference = useSyncExternalStore(nativeTelemetry.subscribe, nativeTelemetry.getChoice);
  const available = useSyncExternalStore(nativeTelemetry.subscribe, nativeTelemetry.isAvailable);
  const promptedServer = useRef<string | null>(null);
  useEffect(() => {
    if (
      !ready ||
      !server ||
      !available ||
      preference !== "undecided" ||
      promptedServer.current === server.baseUrl
    )
      return;
    promptedServer.current = server.baseUrl;
    const choose = (choice: "allow" | "off") => {
      void nativeTelemetry
        .choose(choice, server.baseUrl)
        .catch(() =>
          Alert.alert(
            "Analytics stays off",
            "Could not save your choice. You can try again in Privacy.",
          ),
        );
    };
    Alert.alert(
      "App analytics",
      "Allow this server to receive screen visits, selected actions and technical errors? Post text, media and recordings stay out of analytics. You can change this in Privacy.",
      [
        { text: "Decline", style: "cancel", onPress: () => choose("off") },
        { text: "Allow analytics", onPress: () => choose("allow") },
      ],
      { cancelable: true },
    );
  }, [ready, server, available, preference]);
  const segments = useSegments();
  const screen = `/${segments.filter((segment) => !segment.startsWith("(")).join("/")}`;
  useEffect(() => {
    nativeTelemetry.screen(screen);
  }, [screen, server, token]);
  useEffect(() => {
    if (!ready || !server) return;
    const controller = new AbortController();
    const requestApi = api();
    let failed = false;
    let loading = false;
    async function load() {
      if (loading || controller.signal.aborted) return;
      loading = true;
      try {
        for (let attempt = 0; attempt < 3 && !controller.signal.aborted; attempt++) {
          try {
            const request = new AbortController();
            const cancel = () => request.abort();
            controller.signal.addEventListener("abort", cancel, { once: true });
            const timeout = setTimeout(cancel, 5000);
            let result;
            try {
              result = await requestApi.GET("/telemetry/config", {
                signal: request.signal,
              });
            } finally {
              clearTimeout(timeout);
              controller.signal.removeEventListener("abort", cancel);
            }
            const { data, error } = result;
            if (error || !data) throw new Error("Analytics configuration unavailable");
            if (controller.signal.aborted) return;
            const bootstrap = queryClient
              .getQueriesData<AppBootstrap>({
                queryKey: openPostBootstrapQueryKeys.appRoot(),
              })
              .map(([, value]) => value)
              .find((value) => value?.authenticated && value.user);
            await nativeTelemetry.configure(
              { ...data, enabled: data.enabled && !__DEV__ },
              bootstrap?.user ?? null,
            );
            failed = false;
            return;
          } catch {
            failed = true;
            if (attempt < 2)
              await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
          }
        }
      } finally {
        loading = false;
      }
    }
    void load();
    const foreground = AppState.addEventListener("change", (state) => {
      if (state === "active" && failed) void load();
    });
    return () => {
      controller.abort();
      foreground.remove();
    };
  }, [ready, server, token]);
  return null;
}
