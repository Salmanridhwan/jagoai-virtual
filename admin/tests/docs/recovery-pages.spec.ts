import { expect, test } from "@playwright/test";

for (const scheme of ["light", "dark"] as const) {
  test(`documentation recovery retains its mounted assets and home action in ${scheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    const response = await page.goto("/docs/a-missing-section/a-missing-page");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Page not found", exact: true })).toBeVisible();
    const artwork = page.locator(".op-recovery-art img");
    expect(
      await artwork.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
    ).toBe(true);
    await expect(artwork).toHaveAttribute("src", /^\/docs\/assets\//);
    const home = page.getByRole("link", { name: "Back to docs", exact: true });
    await expect(home).toHaveAttribute("href", /^\/docs\/?$/);
    const rest = await home.evaluate((link) => getComputedStyle(link, "::before").maskImage);
    await home.focus();
    await expect(home).toBeFocused();
    expect(await home.evaluate((link) => getComputedStyle(link, "::before").maskImage)).not.toBe(
      rest,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await home.click();
    await expect(page).toHaveURL(/\/docs\/?$/);
  });
}
