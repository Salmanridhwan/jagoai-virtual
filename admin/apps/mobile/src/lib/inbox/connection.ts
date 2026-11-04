import { useSyncExternalStore } from "react";
import { onlineManager } from "@tanstack/react-query";

export const getInboxOnline = () => onlineManager.isOnline();
const subscribe = (listener: () => void) => onlineManager.subscribe(listener);
export function useInboxOnline() {
  return useSyncExternalStore(subscribe, getInboxOnline, getInboxOnline);
}
export class InboxOfflineError extends Error {
  constructor() {
    super("You’re offline. Your draft is saved. Reconnect, then tap Send.");
    this.name = "InboxOfflineError";
  }
}
export function requireInboxConnection() {
  if (!getInboxOnline()) throw new InboxOfflineError();
}
