#!/usr/bin/env bun

// A release proof is the `release-proof-<sha>-<attempt>` artifact that the
// CI Release Candidate job uploads after every planned gate passed for a main
// push that ran the release plan. Tag CI reuses the earliest proven run for
// the exact tagged SHA instead of repeating its tests. Path-filtered,
// canceled, failed, and pull-request runs never carry a proof.

import { selectAttemptArtifact } from "./ci-artifacts.mjs";

export function releaseProofPrefix(sha) {
  if (!/^[a-f0-9]{40}$/u.test(String(sha ?? ""))) {
    throw new Error("release proofs require a full commit SHA");
  }
  return `release-proof-${sha}-`;
}

// Runs come from the CI workflow's runs API filtered to the SHA. The earliest
// proven run is stable once it exists, so every caller selects the same run.
export function selectProofRun(runs, sha, artifactsForRun) {
  const prefix = releaseProofPrefix(sha);
  const proven = runs
    .filter(
      (run) =>
        run?.head_sha === sha &&
        run?.event === "push" &&
        run?.head_branch === "main" &&
        run?.status === "completed" &&
        run?.conclusion === "success",
    )
    .sort((left, right) => Number(left.id) - Number(right.id));
  for (const run of proven) {
    try {
      selectAttemptArtifact(artifactsForRun(run.id), prefix);
      return String(run.id);
    } catch {
      // A successful run without a proof was path-filtered or predates proofs.
    }
  }
  return undefined;
}

function ghJSON(args) {
  const result = Bun.spawnSync(["gh", "api", ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(`gh api ${args[0]} failed: ${result.stderr.toString().trim()}`);
  }
  return result.stdout
    .toString()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function findReleaseProofRun({ repository, sha }) {
  if (!/^[^/\s]+\/[^/\s]+$/u.test(String(repository ?? ""))) {
    throw new Error("repository must use owner/name format");
  }
  releaseProofPrefix(sha);
  const runs = ghJSON([
    "--paginate",
    `repos/${repository}/actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&branch=main&per_page=100`,
    "--jq",
    ".workflow_runs[] | @json",
  ]);
  return selectProofRun(runs, sha, (runId) =>
    ghJSON([
      "--paginate",
      `repos/${repository}/actions/runs/${runId}/artifacts?per_page=100`,
      "--jq",
      ".artifacts[] | @json",
    ]),
  );
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (import.meta.main) {
  try {
    if (process.argv[2] !== "find") {
      throw new Error("usage: release-proof.mjs find --repository owner/name --sha SHA");
    }
    // Print nothing when no proof exists; callers fall back to full gates.
    const run = findReleaseProofRun({ repository: option("--repository"), sha: option("--sha") });
    if (run) console.log(run);
  } catch (error) {
    console.error(`release-proof: ${error.message}`);
    process.exitCode = 1;
  }
}
