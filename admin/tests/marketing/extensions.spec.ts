import { expect, test } from "@playwright/test";
import { dismissTelemetryConsent } from "./helpers";

test("extensions are discoverable and their install pages fit a phone @desktop", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tools");
  await dismissTelemetryConsent(page);
  await page.getByRole("button", { name: "Extensions", exact: true }).click();
  const extensions = page.locator("#extensions");
  await expect(extensions.getByRole("link", { name: /YouTube Localizer/ })).toBeVisible();
  await expect(extensions.getByRole("link", { name: /Feed Limiter/ })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search free tools" }).fill("Localizer");
  await expect(extensions.getByRole("link")).toHaveCount(1);
  await extensions.getByRole("link", { name: /YouTube Localizer/ }).click();
  await expect(page.getByRole("heading", { name: "YouTube Localizer", exact: true })).toBeVisible();
  for (const [route, storeURL] of [
    [
      "/tools/youtube-localizer",
      "https://chromewebstore.google.com/detail/gblknofeccibdadogbplgcokneofgcdo",
    ],
    [
      "/tools/feed-limiter",
      "https://chromewebstore.google.com/detail/ckiajdbokbecejpammackpihhojjdbke",
    ],
  ]) {
    await page.goto(route);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator("figure img").first()).toBeVisible();
    const settings = page.getByRole("region", {
      name: "Extension settings screenshots",
    });
    await expect(settings.getByRole("img")).toHaveCount(2);
    for (const image of await page.locator("figure img").all()) {
      await image.scrollIntoViewIfNeeded();
      await expect(image).toBeVisible();
      await expect
        .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
        .toBeGreaterThan(0);
    }
    await page.getByRole("link", { name: "Privacy policy", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Privacy policy", exact: true }),
    ).toBeInViewport();
    await expect(
      page.getByRole("heading", {
        name: "Your data and deletion",
        exact: true,
      }),
    ).toBeVisible();
    const install = page.getByRole("link", { name: "Add to Chrome", exact: true });
    await expect(install).toBeVisible();
    await expect(install).toHaveAttribute("href", storeURL);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  }
});

test("old extension links redirect to Feed Limiter @desktop", async ({ request }) => {
  for (const [oldPath, destination] of [
    ["/tools/x-timeline-blocker", "/tools/feed-limiter"],
    ["/tools/x-timeline-blocker/", "/tools/feed-limiter"],
    ["/tools/x-timeline-blocker.md", "/tools/feed-limiter.md"],
  ]) {
    const response = await request.get(`${oldPath}?source=old-link`, {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(301);
    const location = new URL(response.headers().location, response.url());
    expect(location.pathname).toBe(destination);
    expect(location.searchParams.get("source")).toBe("old-link");
  }
});
