import { NativeText as Text } from "@/components/native-text";
import { Image } from "expo-image";
import { useSyncExternalStore, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  appBrandingImage,
  appBrandingQueryOptions,
  defaultAppBranding,
} from "@openpost/query-catalog";
import { mobileQueryAPI } from "@/lib/query-api";
import { useWorkspaceId } from "@/lib/queries";
import { getServer, subscribeServer } from "@/lib/server";
import { getToken, subscribeToken } from "@/lib/api/token-store";
import { useNativeTheme } from "@/theme";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { useColors } from "@/components/ui";

export function Brand({
  compact = false,
  workspace = false,
  style,
}: {
  compact?: boolean;
  workspace?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  const workspaceId = useWorkspaceId();
  const server = useSyncExternalStore(subscribeServer, getServer);
  const token = useSyncExternalStore(subscribeToken, getToken);
  const theme = useNativeTheme();
  const branding = useQuery({
    ...appBrandingQueryOptions(mobileQueryAPI, workspaceId ?? ""),
    enabled: workspace && Boolean(workspaceId && token),
  });
  const profile =
    workspace && token ? (branding.data?.effective ?? defaultAppBranding) : defaultAppBranding;
  const dark = theme.effectiveScheme === "dark";
  const [failed, setFailed] = useState<string[]>([]);
  const wordmark = appBrandingImage(profile, dark, true);
  const logo = appBrandingImage(profile, dark);
  const image = [wordmark?.url, profile.wordmark?.url, logo?.url, profile.logo?.url].find(
    (url) => url && !failed.includes(url),
  );
  const showingWordmark = Boolean(image && [wordmark?.url, profile.wordmark?.url].includes(image));
  // Only server-generated, same-origin branding paths receive the bearer credential.
  const base = server?.baseUrl;
  const imageURL = image && base ? new URL(image, base) : undefined;
  const safe =
    imageURL &&
    base &&
    imageURL.origin === new URL(base).origin &&
    imageURL.pathname.startsWith("/api/v1/app-branding/");
  const size = compact ? 28 : 48;

  return (
    <View accessible accessibilityLabel={profile.display_name} style={[styles.brand, style]}>
      <Image
        source={
          safe
            ? {
                uri: imageURL.toString(),
                headers: token ? { Authorization: `Bearer ${token}` } : {},
              }
            : require("../../assets/images/icon.png")
        }
        cachePolicy="none"
        recyclingKey={safe ? imageURL.toString() : "openpost"}
        onError={() => {
          if (image) setFailed((current) => [...current, image]);
        }}
        style={{
          width: showingWordmark && safe ? 140 : size,
          height: size,
          borderRadius: safe ? 0 : compact ? 10 : 14,
        }}
        contentFit="contain"
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      {!(showingWordmark && safe) && (
        <Text
          numberOfLines={compact ? 1 : undefined}
          maxFontSizeMultiplier={compact ? 1.5 : undefined}
          style={[styles.wordmark, compact && styles.wordmarkCompact, { color: colors.onSurface }]}
        >
          {profile.display_name}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flexShrink: 1,
  },
  wordmarkCompact: { fontSize: 18, lineHeight: 24 },
  wordmark: {
    flexShrink: 1,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
});
