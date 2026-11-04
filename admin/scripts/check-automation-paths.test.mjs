import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { validateAutomationPaths } from "./check-automation-paths.mjs";

function check({
  directory = "/deploy/docker",
  ignore = "docker/library/golang",
  extra = {},
  workflow = "",
  jobs = "",
} = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "openpost-automation-"));
  try {
    const files = {
      ".github/dependabot.yml": `version: 2\nupdates:\n  - package-ecosystem: docker\n    directory: ${directory}\n    ignore:\n      - dependency-name: ${ignore}\n  - package-ecosystem: github-actions\n    directory: /\n`,
      "deploy/docker/Dockerfile":
        "FROM frontend_artifact AS frontend-builder\nFROM public.ecr.aws/docker/library/golang:1.26.9-alpine AS builder\nFROM alpine:3.24.1\n",
      ".github/workflows/ci.yml": `on: push\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/setup-go@v7\n        with:\n          go-version-file: apps/server/go.mod\n          cache-dependency-path: apps/*/go.sum\n      - run: go test ./...\n        working-directory: apps/server\n${workflow}${jobs}`,
      "apps/server/go.mod": "module example.com/server\n",
      "apps/server/go.sum": "",
      ...extra,
    };
    for (const [file, source] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), source);
    }
    const result = validateAutomationPaths(root, Object.keys(files));
    return {
      status: result.problems.length ? 1 : 0,
      stderr: result.problems.join("\n"),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("accepts existing manifests, registry-qualified ignores and workflow inputs", () => {
  const result = check();
  assert.equal(result.status, 0, result.stderr);
});

test("dependency ignore wildcards match registry repository paths", () => {
  const result = check({ ignore: '"*/golang"' });
  assert.equal(result.status, 0, result.stderr);
});

test("rejects a Dependabot directory left behind by a Dockerfile move", () => {
  const result = check({ directory: "/docker" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\/docker: no tracked Dockerfile/);
});

test("rejects a newly added Dockerfile without update coverage", () => {
  const result = check({
    extra: { "deploy/worker/Dockerfile": "FROM alpine:3.24.1\n" },
  });
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /deploy\/worker\/Dockerfile: Dockerfile has no Dependabot update coverage/,
  );
});

test("rejects an ignore rule left behind by a registry migration", () => {
  const result = check({ ignore: "golang" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ignore golang matches no Docker dependency/);
});

test("rejects stale workflow working directories and manifest paths", () => {
  const result = check({
    workflow:
      "      - run: go test ./...\n        working-directory: backend\n      - uses: actions/setup-go@v7\n        with:\n          go-version-file: backend/go.mod\n",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no tracked directory matches backend/);
  assert.match(result.stderr, /no tracked input matches backend\/go.mod/);
});

test("local actions require a tracked entrypoint, not just a remaining directory", () => {
  const workflow = "      - uses: ./.github/actions/check\n";
  const extra = { ".github/actions/check/README.md": "Local check action\n" };
  const missing = check({ workflow, extra });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /local action: no tracked entrypoint/);
  for (const entrypoint of ["action.yml", "action.yaml"]) {
    const present = check({
      workflow,
      extra: { ...extra, [`.github/actions/check/${entrypoint}`]: "name: check\n" },
    });
    assert.equal(present.status, 0, present.stderr);
  }
});

test("local reusable workflow jobs require a tracked workflow file", () => {
  const jobs = "  reuse:\n    uses: ./.github/workflows/reuse.yml\n";
  const missing = check({ jobs });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /local workflow: no tracked input/);
  const present = check({
    jobs,
    extra: { ".github/workflows/reuse.yml": "on: workflow_call\njobs: {}\n" },
  });
  assert.equal(present.status, 0, present.stderr);
});
