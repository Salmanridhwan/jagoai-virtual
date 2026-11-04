import { router, Stack } from "expo-router";
import { StyleSheet, ScrollView, View } from "react-native";
import { Brand } from "@/components/brand";
import { BodyText, Button, PageTitle, Screen } from "@/components/ui";
import { ThemeIcon } from "@/components/theme-icon";
import { useNativeTheme } from "@/theme";

export default function NotFoundScreen() {
  const theme = useNativeTheme();
  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Brand compact />
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <ThemeIcon role="search" size={64} tintColor={theme.manifest.colors.onSurfaceVariant} />
        </View>
        <PageTitle>Page not found</PageTitle>
        <BodyText>The link may be old or mistyped.</BodyText>
        <Button title="Back home" onPress={() => router.replace("/")} style={styles.action} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 20,
    paddingVertical: 32,
  },
  action: { alignSelf: "stretch" },
});
