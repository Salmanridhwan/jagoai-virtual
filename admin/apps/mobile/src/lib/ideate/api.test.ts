import { beforeEach, expect, mock, test } from "bun:test";
import createClient from "openapi-fetch";
import type { paths } from "@openpost/api-contract";

mock.module("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));
const { setServer } = await import("../server");
const { createIdeateAPI } = await import("./api");

beforeEach(async () => {
  await setServer("https://native-ideate.example.com");
});

test("native generation sends four options, a reusable request key, and private source permissions", async () => {
  let received: Request | undefined;
  let body: unknown;
  const client = createClient<paths>({
    baseUrl: "https://native-ideate.example.com/api/v1",
    fetch: async (request) => {
      received = request;
      body = await request.json();
      return Response.json({ id: "build", workspace_id: "workspace", state: "queued" });
    },
  });
  const build = await createIdeateAPI(client).create(
    {
      workspace_id: "workspace",
      idea: "Deleted 15,000 lines",
      option_count: 4,
      account_ids: ["founder"],
      destination_policy: "require_all",
      voice_profile_id: "my-voice",
      context_notes: "Only use the real change",
      assets: [{ media_id: "private-screenshot", role: "context", may_publish: false }],
    },
    "native-retry-key",
    new AbortController().signal,
  );
  expect(build.id).toBe("build");
  expect(received?.headers.get("Idempotency-Key")).toBe("native-retry-key");
  expect(body).toEqual({
    workspace_id: "workspace",
    idea: "Deleted 15,000 lines",
    option_count: 4,
    account_ids: ["founder"],
    destination_policy: "require_all",
    voice_profile_id: "my-voice",
    context_notes: "Only use the real change",
    assets: [{ media_id: "private-screenshot", role: "context", may_publish: false }],
  });
});

test("a late build response cannot enter the native screen after switching servers", async () => {
  let resolve!: (response: Response) => void;
  let started!: () => void;
  const ready = new Promise<void>((done) => {
    started = done;
  });
  const response = new Promise<Response>((done) => {
    resolve = done;
  });
  const client = createClient<paths>({
    baseUrl: "https://native-ideate.example.com/api/v1",
    fetch: async () => {
      started();
      return response;
    },
  });
  const result = createIdeateAPI(client).get("workspace", "build", new AbortController().signal);
  const settled = result.catch((error) => error);
  await ready;
  await setServer("https://different.example.com");
  resolve(Response.json({ id: "build", workspace_id: "workspace", state: "queued" }));
  const failure = await settled;
  expect(failure).toBeInstanceOf(Error);
  expect(failure.message).toContain("Workspace or session changed");
});

test("equal voice-profile reads share the Query owner and reuse its cached result", async () => {
  const { voiceProfilesQueryOptions } = await import("@openpost/query-catalog");
  const { queryClient } = await import("../query-client");
  let requests = 0;
  const client = createClient<paths>({
    baseUrl: "https://native-ideate.example.com/api/v1",
    fetch: async (request) => {
      requests++;
      expect(new URL(request.url).searchParams.get("workspace_id")).toBe("workspace");
      return Response.json([{ id: "voice-1", workspace_id: "workspace", name: "Writing" }]);
    },
  });
  const options = voiceProfilesQueryOptions(createIdeateAPI(client), "workspace");
  const [first, second] = await Promise.all([
    queryClient.fetchQuery(options),
    queryClient.fetchQuery(options),
  ]);
  expect(first).toEqual(second);
  expect(first[0]?.id).toBe("voice-1");
  await queryClient.fetchQuery(options);
  expect(requests).toBe(1);
});
