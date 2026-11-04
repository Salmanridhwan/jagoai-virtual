import { createMDX } from "fumadocs-mdx/next";
import path from "node:path";
import { withPostHogConfig } from "@posthog/nextjs-config";

const withMDX = createMDX();
const docsConfig = withMDX({
  output: "export",
  basePath: "/docs",
  agentRules: false,
  images: { unoptimized: true },
  turbopack: { root: path.resolve("../..") },
  experimental: { cpus: 2 },
  env: {
    NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: process.env.VITE_POSTHOG_PROJECT_TOKEN ?? "",
    NEXT_PUBLIC_POSTHOG_API_HOST: process.env.VITE_POSTHOG_API_HOST ?? "",
    NEXT_PUBLIC_POSTHOG_UI_HOST: process.env.VITE_POSTHOG_UI_HOST ?? "",
    NEXT_PUBLIC_OPENPOST_ENVIRONMENT: process.env.VITE_OPENPOST_ENVIRONMENT ?? "development",
    NEXT_PUBLIC_OPENPOST_VERSION:
      process.env.VITE_OPENPOST_VERSION ??
      process.env.OPENPOST_RELEASE_VERSION ??
      process.env.GITHUB_REF_NAME ??
      "",
    NEXT_PUBLIC_OPENPOST_REVISION: process.env.CF_PAGES_COMMIT_SHA ?? process.env.GITHUB_SHA ?? "",
  },
});

const sourceMapRelease =
  process.env.OPENPOST_RELEASE_VERSION ??
  process.env.GITHUB_SHA ??
  process.env.CF_PAGES_COMMIT_SHA ??
  process.env.VITE_OPENPOST_REVISION;
const uploadSourceMaps = process.env.POSTHOG_SOURCEMAPS_ENABLED === "1";
if (
  uploadSourceMaps &&
  (!process.env.POSTHOG_PERSONAL_API_KEY?.trim() ||
    !process.env.POSTHOG_PROJECT_ID?.trim() ||
    !process.env.POSTHOG_UI_HOST?.trim() ||
    !sourceMapRelease?.trim())
) {
  throw new Error(
    "PostHog source-map upload requires the personal API key, project ID, UI host and release identity",
  );
}
export default uploadSourceMaps
  ? withPostHogConfig(docsConfig, {
      personalApiKey: process.env.POSTHOG_PERSONAL_API_KEY,
      projectId: process.env.POSTHOG_PROJECT_ID,
      host: process.env.POSTHOG_UI_HOST,
      sourcemaps: {
        enabled: true,
        releaseName: "openpost-docs",
        releaseVersion: sourceMapRelease,
        deleteAfterUpload: true,
      },
    })
  : docsConfig;
