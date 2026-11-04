import { Redirect } from "expo-router";
export default function LegacyRoute() {
  return <Redirect href={{ pathname: "/(tabs)/posts", params: { view: "queue" } }} />;
}
