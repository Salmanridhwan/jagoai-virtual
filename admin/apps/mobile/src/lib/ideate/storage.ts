import * as SecureStore from "expo-secure-store";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { getServer } from "../server";
import { getToken } from "../api/token-store";

export function ideateStorageKey(workspaceId: string): string {
  return `ideate-build-${bytesToHex(sha256(utf8ToBytes(JSON.stringify([getServer()?.baseUrl, getToken(), workspaceId]))))}`;
}

export async function readIdeateBuild(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key);
}

export async function rememberIdeateBuild(key: string, id: string): Promise<void> {
  await SecureStore.setItemAsync(key, id);
}
