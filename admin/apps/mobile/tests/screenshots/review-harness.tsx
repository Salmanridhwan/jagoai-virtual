// Browser inspection of the real native review controls, outside the shipping entry.
import { registerRootComponent } from "expo";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ScrollView } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { PublicationReviews } from "../../src/components/publication-reviews";
import { NativeThemeRuntime, useNativeTheme } from "../../src/theme";
import { publicationOptions } from "../../src/lib/queries";
import { loadServer } from "../../src/lib/server";
import { loadToken, loadWorkspaceId } from "../../src/lib/api/token-store";

const queryClient = new QueryClient();
function Review() {
  const publication = useQuery(
    publicationOptions(queryClient, "mobile-review", "client-review", "live"),
  );
  const theme = useNativeTheme();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.manifest.colors.background }}
      contentContainerStyle={{ padding: 16, gap: 16 }}
    >
      {publication.data ? <PublicationReviews publication={publication.data} /> : null}
    </ScrollView>
  );
}
function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <NativeThemeRuntime workspaceId="mobile-review">
        <SafeAreaProvider>
          <Review />
        </SafeAreaProvider>
      </NativeThemeRuntime>
    </QueryClientProvider>
  );
}
Promise.all([loadServer(), loadToken(), loadWorkspaceId()]).then(() => registerRootComponent(App));
