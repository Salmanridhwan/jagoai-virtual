import { DitherPressable } from "@/components/dither-pressable";
import { useState } from "react";
import { View } from "react-native";

import { NativeText } from "@/components/native-text";
import { Brand } from "@/components/brand";
import { WorkspaceAvatar } from "@/components/account-avatar";
import { ThemeIcon } from "@/components/theme-icon";
import { WorkspaceMenu } from "@/components/workspace-menu";
import { useWorkspaces, useWorkspaceId } from "@/lib/queries";
import { useNativeTheme } from "@/theme";

export function WorkspaceHeader({ children }: { children?: React.ReactNode }) {
  const { colors, spacing, shape } = useNativeTheme().manifest;
  const workspaces = useWorkspaces();
  const workspaceId = useWorkspaceId();
  const [menuOpen, setMenuOpen] = useState(false);
  const workspace = workspaces.data?.find((candidate) => candidate.id === workspaceId);
  const name = workspace?.name;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.small,
        paddingHorizontal: spacing.large,
        paddingVertical: spacing.extraSmall,
      }}
    >
      <DitherPressable
        radius={shape.medium}
        focusColor={colors.focus}
        accessibilityRole="button"
        accessibilityLabel={`Open workspace menu${name ? `, ${name}` : ""}`}
        onPress={() => setMenuOpen(true)}
        style={({ pressed }) => ({
          flex: 1,
          minHeight: 48,
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.small,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <WorkspaceAvatar
          name={workspace?.name ?? ""}
          avatarUrl={workspace?.avatar_url}
          color={workspace?.color}
          size={28}
        />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Brand compact workspace />
          <NativeText numberOfLines={1} style={{ color: colors.onSurfaceVariant, fontSize: 12 }}>
            {name}
          </NativeText>
        </View>
        <ThemeIcon role="disclosure" size={14} tintColor={colors.onSurfaceVariant} />
      </DitherPressable>
      {children}
      {menuOpen ? (
        <WorkspaceMenu onClose={() => setMenuOpen(false)} workspaces={workspaces.data ?? []} />
      ) : null}
    </View>
  );
}
