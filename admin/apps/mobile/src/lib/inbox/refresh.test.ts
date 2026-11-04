import { expect, test } from "bun:test";
import { lastSuccessfulSync } from "./refresh";

test("an uncollected feed has no successful collection date", () => {
  expect(
    lastSuccessfulSync([
      { social_account_id: "account", last_success_at: "0001-01-01T00:00:00Z" },
      { social_account_id: "account", last_success_at: "not-a-date" },
    ]),
  ).toBeUndefined();
});

test("collection status retains the latest real date for the selected account", () => {
  expect(
    lastSuccessfulSync(
      [
        { social_account_id: "account", last_success_at: "0001-01-01T00:00:00Z" },
        { social_account_id: "account", last_success_at: "2026-10-24T12:00:00Z" },
        { social_account_id: "other", last_success_at: "2026-10-24T13:00:00Z" },
      ],
      "account",
    ),
  ).toBe("2026-10-24T12:00:00Z");
});
