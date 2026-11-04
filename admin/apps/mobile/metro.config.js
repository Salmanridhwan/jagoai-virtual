const fs = require("node:fs");
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const config = getDefaultConfig(projectRoot);
const dependencyRoots = [
  path.join(projectRoot, "node_modules"),
  path.join(workspaceRoot, "node_modules"),
];
const workspaceSources = [
  path.join(workspaceRoot, "packages", "api-contract"),
  path.join(workspaceRoot, "packages", "dither"),
  path.join(workspaceRoot, "packages", "query-catalog"),
  path.join(workspaceRoot, "packages", "platform-text"),
];
const installedWorkspaceSources = path.join(projectRoot, "node_modules", "@openpost");

// Workspace packages ship TypeScript with ESM-style `.js` specifiers, which Node
// and bundlers resolve to the emitted JavaScript. Metro consumes their `src/`
// through the `react-native` export condition, where only the `.ts` file exists
// and Metro does not infer it, so map those specifiers back to the source file.
// `file:` dependencies are linked on some installs and copied on others, so
// accept both the workspace path and the installed copy.
const typescriptSourceRequest = (originModulePath, moduleName) => {
  if (!originModulePath || !moduleName.startsWith(".") || !moduleName.endsWith(".js")) {
    return null;
  }
  const inWorkspace = workspaceSources.some((root) =>
    originModulePath.startsWith(`${root}${path.sep}`),
  );
  if (!inWorkspace && !originModulePath.startsWith(`${installedWorkspaceSources}${path.sep}`)) {
    return null;
  }
  const request = `${moduleName.slice(0, -".js".length)}.ts`;
  return fs.existsSync(path.resolve(path.dirname(originModulePath), request)) ? request : null;
};

config.watchFolders = workspaceSources;
config.resolver.nodeModulesPaths = dependencyRoots;
config.resolver.resolveRequest = (context, moduleName, platform) =>
  context.resolveRequest(
    { ...context, disableHierarchicalLookup: true, nodeModulesPaths: dependencyRoots },
    typescriptSourceRequest(context.originModulePath, moduleName) ?? moduleName,
    platform,
  );
module.exports = config;
