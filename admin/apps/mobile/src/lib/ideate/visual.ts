import type { ScreenshotDocument } from "@openpost/query-catalog";
import * as FileSystem from "expo-file-system/legacy";
import { api, errorMessage } from "../api/client";
import { uploadAttachment } from "../media";

export type RenderedVisual = { base64: string; document: ScreenshotDocument };
export type ExportVisual = () => Promise<RenderedVisual>;

export async function previewMeme(
  workspaceId: string,
  document: ScreenshotDocument,
  signal: AbortSignal,
): Promise<string> {
  if (!document.meme) throw new Error("This post has no meme recipe.");
  const result = await api().POST("/memes/preview", {
    signal,
    body: {
      workspace_id: workspaceId,
      template_id: document.meme.template_id,
      captions: document.meme.captions,
      overlay_media_ids: document.meme.overlay_media_ids,
      format: "png",
    },
  });
  if (result.error || !result.data)
    throw new Error(
      await errorMessage(result.response, "Could not render this meme", result.error),
    );
  return result.data.data_base64;
}

export async function saveIdeateVisual(
  workspaceId: string,
  visual: RenderedVisual,
  altText: string,
  stillCurrent: () => boolean,
): Promise<string> {
  const client = api();
  const check = () => {
    if (!stillCurrent()) throw new Error("Your Workspace or session changed.");
  };
  check();
  const recipe = await client.POST("/screenshot-templates/designs", {
    body: { workspace_id: workspaceId, document: visual.document },
  });
  check();
  if (recipe.error || !recipe.data)
    throw new Error(
      await errorMessage(recipe.response, "Could not save the editable visual", recipe.error),
    );
  const file = `${FileSystem.cacheDirectory}ideate-${recipe.data.id}.png`;
  try {
    await FileSystem.writeAsStringAsync(file, visual.base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    check();
    const mediaId = await uploadAttachment(
      {
        localId: `template:${recipe.data.id}`,
        uri: file,
        mimeType: "image/png",
        filename: `${visual.document.title || "Post"}.png`,
        size: null,
      },
      { workspaceId, client, source: "screenshot_template", altText },
    );
    check();
    const exported = await client.POST("/screenshot-templates/designs/{id}/exports", {
      params: { path: { id: recipe.data.id } },
      body: { revision: recipe.data.revision, media_id: mediaId },
    });
    check();
    if (exported.error)
      throw new Error(
        await errorMessage(
          exported.response,
          "Could not keep this visual editable",
          exported.error,
        ),
      );
    return mediaId;
  } finally {
    await FileSystem.deleteAsync(file, { idempotent: true });
  }
}
