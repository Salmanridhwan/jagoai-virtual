import { expect, test } from "@playwright/test";
import { assertCaptureViewport, captureViewport } from "./product-capture-fixtures";

test.use({ viewport: captureViewport });

test("product capture accepts a document narrower than the viewport", async ({ page }) => {
  await page.setContent(`
    <style>
      /* Reproduce the Linux capture geometry on platforms with overlay scrollbars. */
      html { width: calc(100% - 15px); }
      body { margin: 0; }
    </style>
    <main>Product screenshot</main>
  `);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1425);
  await assertCaptureViewport(page);
});

test("product capture rejects horizontal overflow", async ({ page }) => {
  await page.setContent(`
    <style>body { margin: 0; } main { width: 1500px; }</style>
    <main>Overflowing product screenshot</main>
  `);
  await expect(assertCaptureViewport(page)).rejects.toThrow();
});
