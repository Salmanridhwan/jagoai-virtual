import { Redirect } from "expo-router";
import { useLaunchSession } from "@/lib/launch-session";
import { InitialQueryError, LaunchPlaceholder } from "../query-state";
import { Screen } from "../ui";

/** Deep links must wait for the identity transaction before opening local drafts. */
export function InboxSessionBoundary({ children }: { children: React.ReactNode }) {
  const launch = useLaunchSession();
  if (launch.state.status === "loading") return <LaunchPlaceholder pending offline={false} />;
  if (launch.state.status === "error")
    return (
      <Screen>
        <InitialQueryError
          title="Could not open Inbox"
          message={launch.state.error.message}
          retry={launch.reload}
        />
      </Screen>
    );
  if (!launch.state.session.signedIn) return <Redirect href="/" />;
  if (!launch.state.session.workspaceId) return <Redirect href="/onboarding/workspace" />;
  return children;
}
