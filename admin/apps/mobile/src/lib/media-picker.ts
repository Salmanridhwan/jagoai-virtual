import * as ImagePicker from "expo-image-picker";
import type { ImagePickerAsset } from "expo-image-picker";
import { MAX_MOBILE_ATTACHMENT_COUNT, ORIGINAL_IMAGE_QUALITY } from "./media";

export const CAMERA_PERMISSION_MESSAGE = "Allow camera access in Settings to take a photo.";

export interface PickMediaOptions {
  source: "library" | "camera";
  mediaTypes: ("images" | "videos")[];
  multiple?: boolean;
  limit?: number;
  quality?: number;
}

export type PickMediaResult = { canceled: true } | { canceled: false; assets: ImagePickerAsset[] };

/**
 * Single owner for mobile attachment picking. Screens pass what they need;
 * permission requests, media-type selection, the multi-select limit, and the
 * quality default live here. Rejects with CAMERA_PERMISSION_MESSAGE when the
 * camera permission is denied so the caller can report it directly.
 */
export async function pickMedia(options: PickMediaOptions): Promise<PickMediaResult> {
  const quality = options.quality ?? ORIGINAL_IMAGE_QUALITY;
  if (options.source === "camera") {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      throw new Error(CAMERA_PERMISSION_MESSAGE);
    }
    return ImagePicker.launchCameraAsync({
      mediaTypes: options.mediaTypes,
      quality,
    });
  }
  const multiple = options.multiple ?? false;
  return ImagePicker.launchImageLibraryAsync({
    mediaTypes: options.mediaTypes,
    allowsMultipleSelection: multiple,
    ...(multiple ? { selectionLimit: options.limit ?? MAX_MOBILE_ATTACHMENT_COUNT } : {}),
    quality,
  });
}
