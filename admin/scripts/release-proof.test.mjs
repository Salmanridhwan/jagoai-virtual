import assert from "node:assert/strict";
import test from "node:test";

import { selectProofRun } from "./release-proof.mjs";

const sha = "a".repeat(40);
const run = (id, overrides = {}) => ({
  id,
  head_sha: sha,
  event: "push",
  head_branch: "main",
  status: "completed",
  conclusion: "success",
  ...overrides,
});
const proof = (attempt = 1, expired = false) => [
  { name: `release-proof-${sha}-${attempt}`, expired },
];

test("selects the earliest green main run that recorded a proof", () => {
  const artifacts = { 30: proof(2), 20: proof(), 10: [] };
  assert.equal(
    selectProofRun([run(30), run(20), run(10)], sha, (id) => artifacts[id]),
    "20",
  );
});

test("never treats unproven, failed, canceled, or non-main runs as proof", () => {
  const runs = [
    run(1, { conclusion: "failure" }),
    run(2, { conclusion: "cancelled" }),
    run(3, { status: "in_progress", conclusion: null }),
    run(4, { event: "pull_request" }),
    run(5, { head_branch: "v9.9.9" }),
    run(6, { head_sha: "b".repeat(40) }),
    run(7),
  ];
  const artifacts = { 7: proof(1, true) };
  assert.equal(
    selectProofRun(runs, sha, (id) => artifacts[id] ?? proof()),
    undefined,
  );
});

test("requires a full commit SHA", () => {
  assert.throws(() => selectProofRun([], "abc123", () => []));
});
