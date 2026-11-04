import { beforeEach, expect, mock, test } from "bun:test";
import type { ImagePickerAsset, ImagePickerResult } from "expo-image-picker";
import "../../tests/fixtures/file-system";

mock.module("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));

let cameraGranted = true;
let nextLibraryResult: ImagePickerResult = { canceled: true, assets: null };
let nextCameraResult: ImagePickerResult = { canceled: true, assets: null };
const launchImageLibraryAsync = mock(
  async (_options: unknown): Promise<ImagePickerResult> => nextLibraryResult,
);
const launchCameraAsync = mock(
  async (_options: unknown): Promise<ImagePickerResult> => nextCameraResult,
);
mock.module("expo-image-picker", () => ({
  requestCameraPermissionsAsync: async () => ({ granted: cameraGranted }),
  launchImageLibraryAsync,
  launchCameraAsync,
}));

const { pickMedia, CAMERA_PERMISSION_MESSAGE } = await import("./media-picker");
const { MAX_MOBILE_ATTACHMENT_COUNT, ORIGINAL_IMAGE_QUALITY } = await import("./media");

beforeEach(() => {
  cameraGranted = true;
  nextLibraryResult = { canceled: true, assets: null };
  nextCameraResult = { canceled: true, assets: null };
  launchImageLibraryAsync.mockClear();
  launchCameraAsync.mockClear();
});

test("library single selection maps images with the original quality default", async () => {
  const result = await pickMedia({ source: "library", mediaTypes: ["images"] });
  expect(result.canceled).toBe(true);
  expect(launchImageLibraryAsync).toHaveBeenCalledTimes(1);
  expect(launchImageLibraryAsync.mock.calls[0][0]).toEqual({
    mediaTypes: ["images"],
    allowsMultipleSelection: false,
    quality: ORIGINAL_IMAGE_QUALITY,
  });
});

test("library multiple selection passes the caller limit", async () => {
  await pickMedia({
    source: "library",
    mediaTypes: ["images", "videos"],
    multiple: true,
    limit: 3,
  });
  expect(launchImageLibraryAsync.mock.calls[0][0]).toEqual({
    mediaTypes: ["images", "videos"],
    allowsMultipleSelection: true,
    selectionLimit: 3,
    quality: ORIGINAL_IMAGE_QUALITY,
  });
});

test("library multiple selection defaults the limit to the shared attachment cap", async () => {
  await pickMedia({ source: "library", mediaTypes: ["images", "videos"], multiple: true });
  const options = launchImageLibraryAsync.mock.calls[0][0] as { selectionLimit: number };
  expect(options.selectionLimit).toBe(MAX_MOBILE_ATTACHMENT_COUNT);
});

test("video-only library picks gain the shared quality default", async () => {
  await pickMedia({ source: "library", mediaTypes: ["videos"] });
  const options = launchImageLibraryAsync.mock.calls[0][0] as { quality: number };
  expect(options.quality).toBe(ORIGINAL_IMAGE_QUALITY);
});

test("camera capture always sets media types", async () => {
  await pickMedia({ source: "camera", mediaTypes: ["images"] });
  expect(launchCameraAsync).toHaveBeenCalledTimes(1);
  const options = launchCameraAsync.mock.calls[0][0] as {
    mediaTypes: unknown;
    quality: number;
  };
  expect(options.mediaTypes).toEqual(["images"]);
  expect(options.quality).toBe(ORIGINAL_IMAGE_QUALITY);
});

test("successful picks return the assets", async () => {
  const asset = { uri: "file:///photo.jpg" } as ImagePickerAsset;
  nextCameraResult = { canceled: false, assets: [asset] } as ImagePickerResult;
  const result = await pickMedia({ source: "camera", mediaTypes: ["images"] });
  expect(result.canceled).toBe(false);
  if (!result.canceled) expect(result.assets).toEqual([asset]);
});

test("denied camera permission rejects with a showable message", async () => {
  cameraGranted = false;
  let error: unknown;
  try {
    await pickMedia({ source: "camera", mediaTypes: ["images"] });
  } catch (err) {
    error = err;
  }
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe(CAMERA_PERMISSION_MESSAGE);
  expect((error as Error).message.length).toBeGreaterThan(0);
  expect(launchCameraAsync).not.toHaveBeenCalled();
});
