import { expect, test } from "bun:test";
import { analyticsAccountOptions } from "./analytics-accounts";

const overviewAccounts = [
  { id: "account-1", platform: "mastodon", username: "alice" },
  { id: "account-2", platform: "x", username: "bob" },
];

test("a selected account the overview still describes stays selected", () => {
  const { options, effectiveAccountId } = analyticsAccountOptions(overviewAccounts, "account-2");
  expect(options).toHaveLength(2);
  expect(effectiveAccountId).toBe("account-2");
});

test("a stale accountId resolves to the all-accounts state", () => {
  const { options, effectiveAccountId } = analyticsAccountOptions(
    [overviewAccounts[0]],
    "account-2",
  );
  expect(options.map((account) => account.id)).toEqual(["account-1"]);
  expect(effectiveAccountId).toBe("");
});

test("a successful result that omits the selection resets it, even when empty", () => {
  for (const empty of [undefined, null, []] as const) {
    const { effectiveAccountId } = analyticsAccountOptions(empty, "account-2");
    expect(effectiveAccountId).toBe("");
  }
});

test("an empty selection stays at all accounts", () => {
  const { effectiveAccountId } = analyticsAccountOptions(overviewAccounts, "");
  expect(effectiveAccountId).toBe("");
});
