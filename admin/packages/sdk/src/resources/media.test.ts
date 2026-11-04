import { describe, expect, it, vi } from "vitest";
import { OpenPost } from "../index";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Media uploads", () => {
  it("returns the deduped row without uploading bytes", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        media_id: "media_1",
        deduped: true,
        complete_url: "/api/v1/media/upload-session/media_1/complete",
        upload: { method: "PUT", url: "https://storage.test/x", headers: {} },
      }),
    );
    const client = new OpenPost({ baseUrl: "https://example.test", token: "tok", fetch });
    const result = await client.media.upload({
      workspaceId: "ws_1",
      file: new Uint8Array([1, 2, 3]),
      filename: "cover.png",
      mimeType: "image/png",
    });
    expect(result).toMatchObject({ id: "media_1", deduped: true });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("creates a session, puts bytes to the target, then completes", async () => {
    const fetch = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.endsWith("/api/v1/media/upload-session")) {
        return jsonResponse({
          media_id: "media_2",
          deduped: false,
          complete_url: "/api/v1/media/upload-session/media_2/complete",
          upload: {
            method: "PUT",
            url: "https://storage.test/x",
            headers: { "x-amz-acl": "private" },
          },
        });
      }
      if (target === "https://storage.test/x") return new Response(null, { status: 200 });
      if (target.endsWith("/complete")) {
        return jsonResponse({
          id: "media_2",
          mime_type: "image/png",
          url: "/media/media_2",
          size: 3,
        });
      }
      throw new Error(`unexpected request to ${target}`);
    });
    const client = new OpenPost({ baseUrl: "https://example.test", token: "tok", fetch });
    const result = await client.media.upload({
      workspaceId: "ws_1",
      file: new Uint8Array([1, 2, 3]),
      filename: "cover.png",
      mimeType: "image/png",
      altText: "Cover art",
    });
    expect(result.id).toBe("media_2");
    expect(fetch).toHaveBeenCalledTimes(3);

    // The external storage target must not receive the API token.
    const [, putInit] = fetch.mock.calls[1] as unknown as [string, RequestInit];
    const putHeaders = putInit.headers as Record<string, string>;
    expect(putHeaders["Authorization"]).toBeUndefined();
    expect(putHeaders["x-amz-acl"]).toBe("private");
  });

  it("sends the bearer token to internal upload targets", async () => {
    const fetch = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.endsWith("/api/v1/media/upload-session")) {
        return jsonResponse({
          media_id: "media_3",
          deduped: false,
          complete_url: "/api/v1/media/upload-session/media_3/complete",
          upload: {
            method: "PUT",
            url: "/api/v1/media/upload-session/media_3/content",
            headers: {},
          },
        });
      }
      if (target.endsWith("/content")) return new Response(null, { status: 200 });
      if (target.endsWith("/complete")) {
        return jsonResponse({
          id: "media_3",
          mime_type: "image/png",
          url: "/media/media_3",
          size: 3,
        });
      }
      throw new Error(`unexpected request to ${target}`);
    });
    const client = new OpenPost({ baseUrl: "https://example.test", token: "tok", fetch });
    const result = await client.media.upload({
      workspaceId: "ws_1",
      file: new Uint8Array([1, 2, 3]),
      filename: "cover.png",
      mimeType: "image/png",
    });
    expect(result.id).toBe("media_3");
    const [, putInit] = fetch.mock.calls[1] as unknown as [string, RequestInit];
    const putHeaders = putInit.headers as Record<string, string>;
    expect(putHeaders["Authorization"]).toBe("Bearer tok");
  });
  it("prepares a separate destination image and retains explicit empty alt text", async () => {
    let requested = "";
    let payload: unknown;
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requested = String(url);
      payload = JSON.parse(String(init?.body));
      return jsonResponse({
        status: "ready",
        media: { id: "fitted", parent_media_id: "original", processing_status: "ready" },
      });
    });
    const client = new OpenPost({ baseUrl: "https://example.test", token: "tok", fetch });
    const prepared = await client.media.prepareImage("original", {
      account_id: "account-1",
      output_profile: "linkedin.post",
      alt_text: "",
    });
    expect(requested).toBe("https://example.test/api/v1/media/original/prepare-image");
    expect(payload).toEqual({
      account_id: "account-1",
      output_profile: "linkedin.post",
      alt_text: "",
    });
    expect(prepared).toMatchObject({
      status: "ready",
      media: { id: "fitted", parent_media_id: "original" },
    });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
