import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("text cards show a dismissible notice without a missing-image warning", async ({
  page,
  request,
}) => {
  const auth = await registerUser(request, `text-card-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Text card previews");
  const accountID = randomUUID();
  execFileSync("sqlite3", [
    "-cmd",
    ".timeout 5000",
    process.env.OPENPOST_APP_E2E_DB_PATH ??
      `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
    `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${accountID}','${workspace.id}','card-${accountID}','instagram','${accountID}','samplefounder',X'00',1);`,
  ]);
  const response = await request.post("/api/v1/publications", {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: {
      workspace_id: workspace.id,
      title: "Text card",
      content_profile: "short_text",
      source_text: "A small release worth sharing.",
      social_account_ids: [accountID],
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const publication = await response.json();
  expect(publication.renditions[0].segments[0].output_media[0].role).toBe("text_card");
  // Reopening a saved card must work even while fresh rendering is unavailable.
  let previewRequests = 0;
  await page.route("**/api/v1/publications/preview-text-card", async (route) => {
    previewRequests++;
    await route.fulfill({
      status: 429,
      json: { detail: "Text card rendering is busy; try again shortly" },
    });
  });
  await authenticatePage(page, auth.token);
  await page.goto(`/publications/${publication.id}?workspace_id=${workspace.id}`);
  const customize = page.getByRole("button", { name: "Customize card", exact: true });
  await expect(customize).toBeVisible({ timeout: 60000 });
  await page.getByRole("button", { name: /^Accounts:/ }).click();
  await expect(
    page.getByText("Instagram publishing requires 1-10 image or video attachments.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page.getByText("Text will be published as an image.", { exact: true })).toHaveCount(
    0,
  );
  await page.keyboard.press("Escape");
  await customize.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("img", { name: "Text card 1", exact: true })).toBeVisible();
  await expect(dialog.getByRole("img", { name: "Text card 1", exact: true })).toHaveAttribute(
    "src",
    publication.renditions[0].segments[0].output_media[0].url,
  );
  await expect
    .poll(() =>
      dialog
        .getByRole("img", { name: "Text card 1", exact: true })
        .evaluate(
          (image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
        ),
    )
    .toBe(true);
  expect(previewRequests).toBe(0);
  await page.keyboard.press("Escape");
  await expect(customize).toBeFocused();
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(customize).toHaveCount(0);
});
