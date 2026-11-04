/** React Native supports abort events, but not browser AbortSignal.any/timeout helpers. */
export function inboxAbortScope(signals: readonly AbortSignal[], timeoutMs?: number) {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  for (const signal of signals) {
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  }
  const timer =
    timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          abort();
        }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      for (const signal of signals) signal.removeEventListener("abort", abort);
    },
  };
}
