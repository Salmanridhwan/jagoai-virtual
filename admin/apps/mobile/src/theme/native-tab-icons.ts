import type { ImageSourcePropType } from "react-native";

import type { NativeThemeManifest } from "./contract";
import {
  INBOX_NAVIGATION_ICONS,
  type InboxNavigationRole,
} from "./inbox-navigation-icons.generated";
import { NATIVE_TAB_ICON_SOURCES } from "./native-tab-icon-sources.generated";
import {
  resolveNativeThemeNavigationIconPack,
  type NativeTabIconRole,
} from "./native-tab-icon-selection";

export type { NativeTabIconRole } from "./native-tab-icon-selection";

export function resolveNativeThemeNavigationIcon(
  manifest: NativeThemeManifest,
  role: NativeTabIconRole | InboxNavigationRole,
): ImageSourcePropType {
  const pack = resolveNativeThemeNavigationIconPack(manifest);
  if (role === "inbox" || role === "media" || role === "more")
    return INBOX_NAVIGATION_ICONS[pack][role];
  return NATIVE_TAB_ICON_SOURCES[pack][role];
}
