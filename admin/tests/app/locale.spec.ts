import { expect, test } from "@playwright/test";

test.use({ locale: "ru-RU" });

test("a fresh Russian browser selects Russian", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Войти", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
});

test("a saved language takes precedence over the browser language", async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([{ name: "PARAGLIDE_LOCALE", value: "en", url: baseURL! }]);
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign In", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("Russian login recovery fits a narrow phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.route("**/api/v1/auth/config", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
  );
  await page.goto("/login");
  await expect(page.getByRole("status")).toContainText("Не удалось загрузить настройки аккаунта.", {
    timeout: 30_000,
  });
  await expect(page.getByRole("status").getByRole("button")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
