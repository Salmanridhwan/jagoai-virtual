#!/usr/bin/env bun

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";

// Validate maintained inputs, never generated artifacts or runner-local paths.
export function validateAutomationPaths(root, files) {
  const problems = [];
  const readYAML = (file) => load(readFileSync(path.join(root, file), "utf8"));
  const dockerfiles = files.filter((file) => /^Dockerfile(?:\..+)?$/.test(path.basename(file)));
  const workflows = files.filter((file) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(file));
  const covered = new Set();
  let actionsCovered = false;

  function matches(pattern, value) {
    return new Bun.Glob(pattern).match(value);
  }

  function requireInput(value, label, { directory = false } = {}) {
    if (!value || value.includes("${{")) return;
    for (const input of value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)) {
      const target = path.posix.normalize(input);
      const found = directory
        ? target === "." || files.some((file) => file.startsWith(`${target}/`))
        : files.some((file) => matches(target, file));
      if (!found)
        problems.push(`${label}: no tracked ${directory ? "directory" : "input"} matches ${input}`);
    }
  }

  const config = readYAML(".github/dependabot.yml");
  if (config.version !== 2 || !Array.isArray(config.updates) || !config.updates.length) {
    throw new Error("Dependabot must declare version 2 and at least one update job");
  }
  for (const update of config.updates) {
    const ecosystem = update["package-ecosystem"];
    const directories = update.directories ?? [update.directory];
    for (const directory of directories) {
      if (typeof directory !== "string" || !directory.startsWith("/")) {
        problems.push(`Dependabot ${ecosystem}: directory must be repository-absolute`);
        continue;
      }
      const relative = directory.slice(1).replace(/\/$/, "");
      const label = `Dependabot ${ecosystem} ${directory}`;
      if (ecosystem === "github-actions") {
        if (relative || !workflows.length)
          problems.push(`${label}: workflows must be covered from /`);
        else actionsCovered = true;
        continue;
      }
      if (ecosystem !== "docker") {
        problems.push(`${label}: add manifest validation for this ecosystem`);
        continue;
      }
      const manifests = dockerfiles.filter((file) =>
        matches(relative || ".", path.posix.dirname(file)),
      );
      if (!manifests.length) problems.push(`${label}: no tracked Dockerfile matches directory`);
      const dependencies = new Set();
      for (const file of manifests) {
        covered.add(file);
        const source = readFileSync(path.join(root, file), "utf8");
        for (const match of source.matchAll(/^FROM\s+(?:--platform=\S+\s+)?(\S+)/gim)) {
          let image = match[1];
          // Untagged names are build stages/contexts, not updater dependencies.
          if (!image.includes(":") && !image.includes("@")) continue;
          image = image.split("@")[0].replace(/:[^/]+$/, "");
          const parts = image.split("/");
          if (parts.length > 1 && /[.:]|^localhost$/.test(parts[0])) parts.shift();
          dependencies.add(parts.join("/"));
        }
      }
      if (manifests.length) {
        for (const rule of update.ignore ?? []) {
          const pattern = rule["dependency-name"];
          // Dependabot dependency wildcards match slashes too, unlike path globs.
          const escaped = pattern
            ?.split("*")
            .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
          const rulePattern = escaped && new RegExp(`^${escaped.join(".*")}$`);
          if (!rulePattern || ![...dependencies].some((name) => rulePattern.test(name))) {
            problems.push(`${label}: ignore ${pattern} matches no Docker dependency`);
          }
        }
      }
    }
  }
  for (const file of dockerfiles) {
    if (!covered.has(file)) problems.push(`${file}: Dockerfile has no Dependabot update coverage`);
  }
  if (workflows.length && !actionsCovered) {
    problems.push("GitHub Actions workflows have no Dependabot update coverage");
  }

  for (const file of workflows) {
    const workflow = readYAML(file);
    requireInput(workflow.defaults?.run?.["working-directory"], `${file} defaults`, {
      directory: true,
    });
    for (const [id, job] of Object.entries(workflow.jobs ?? {})) {
      const label = `${file} job ${id}`;
      if (job.uses?.startsWith("./")) requireInput(job.uses, `${label} local workflow`);
      const defaultDirectory =
        job.defaults?.run?.["working-directory"] ?? workflow.defaults?.run?.["working-directory"];
      requireInput(defaultDirectory, `${label} defaults`, { directory: true });
      for (const step of job.steps ?? []) {
        requireInput(step["working-directory"], label, { directory: true });
        if (step.uses?.startsWith("./")) {
          const directory = path.posix.normalize(step.uses);
          if (
            !["action.yml", "action.yaml", "Dockerfile"].some((entrypoint) =>
              files.includes(path.posix.join(directory, entrypoint)),
            )
          ) {
            problems.push(`${label} local action: no tracked entrypoint in ${step.uses}`);
          }
        }
        for (const key of [
          "go-version-file",
          "node-version-file",
          "bun-version-file",
          "cache-dependency-path",
        ]) {
          requireInput(step.with?.[key], `${label} ${key}`);
        }
      }
    }
  }

  return {
    problems,
    dockerfiles: dockerfiles.length,
    workflows: workflows.length,
  };
}

if (import.meta.main) {
  const root = process.cwd();
  const files = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
  const result = validateAutomationPaths(root, files);
  if (result.problems.length) {
    console.error(result.problems.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(
      `Automation paths valid: ${result.dockerfiles} Dockerfile(s), ${result.workflows} workflow(s).`,
    );
  }
}
