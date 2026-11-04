import { expect, test } from "bun:test";
import { orderedCommentAncestors } from "./ancestors";
test("nested comment context keeps root through immediate parent in reading order even when the canonical records arrive unordered", () => {
  const root = { remote_id: "root", parent_remote_id: "", body: "The release notes are ready." };
  const middle = {
    remote_id: "middle",
    parent_remote_id: "root",
    body: "Can we include the demo?",
  };
  const parent = {
    remote_id: "parent",
    parent_remote_id: "middle",
    body: "Yes, the video is ready.",
  };
  expect(orderedCommentAncestors({ parent_remote_id: "parent" }, [parent, root, middle])).toEqual([
    root,
    middle,
    parent,
  ]);
});
test("missing or cyclic stored context is bounded without inventing ancestors or including unrelated comments", () => {
  const parent = { remote_id: "parent", parent_remote_id: "missing" };
  expect(
    orderedCommentAncestors({ parent_remote_id: "parent" }, [
      parent,
      { remote_id: "unrelated", parent_remote_id: "" },
    ]),
  ).toEqual([parent]);
  expect(
    orderedCommentAncestors({ parent_remote_id: "parent" }, [
      { ...parent, parent_remote_id: "parent" },
    ]),
  ).toHaveLength(1);
});
