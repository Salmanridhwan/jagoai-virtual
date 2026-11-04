import * as WebBrowser from "expo-web-browser";
import { BodyText, Button } from "../ui";
import { getServer } from "@/lib/server";
import { View } from "react-native";
import { useState } from "react";

export function XMessagingRecovery({
  accountId,
  workspaceId,
}: {
  accountId: string;
  workspaceId: string;
}) {
  const [error, setError] = useState<string | null>(null);
  async function openSettings() {
    const server = getServer();
    if (!server) return;
    const url = new URL("/settings", server.baseUrl);
    url.searchParams.set("tab", "accounts");
    url.searchParams.set("account_id", accountId);
    url.searchParams.set("workspace_id", workspaceId);
    try {
      await WebBrowser.openBrowserAsync(url.toString());
    } catch {
      setError("Could not open account settings. Try again.");
    }
  }
  return (
    <View style={{ gap: 8 }}>
      <BodyText>
        X messaging uses its own authorization and account limits. Manage messaging access in
        account settings.
      </BodyText>
      <Button title="Manage X messaging" intent="ordinary" onPress={() => void openSettings()} />
      {error ? <BodyText accessibilityRole="alert">{error}</BodyText> : null}
    </View>
  );
}
