import { expect, test } from "@playwright/test";
import { signInAsNewLearner } from "./support/session";

// Not a check: captures screens for a visual review. Run with `npx playwright test screenshots`.
test.skip(!process.env.CAPTURE_SCREENSHOTS, "set CAPTURE_SCREENSHOTS=1 to capture");

test("capture main screens", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInAsNewLearner(page, "shots");
  await page.getByLabel(/Show unreviewed drafts/).check();
  await expect(page.getByRole("link", { name: "Checkout totals" })).toBeVisible();
  await page.screenshot({ path: "test-results/screens/home.png", fullPage: true });
  await page.getByRole("link", { name: "Checkout totals" }).click();
  await page.waitForFunction(() => Boolean((window as unknown as { monaco?: unknown }).monaco));
  await page.getByRole("button", { name: "Run samples" }).click();
  await expect(page.getByTestId("results")).toBeVisible({ timeout: 180_000 });
  await page.screenshot({ path: "test-results/screens/quest.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.screenshot({ path: "test-results/screens/home-mobile.png", fullPage: true });
});
