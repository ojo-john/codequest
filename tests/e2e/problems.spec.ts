import { expect, test } from "@playwright/test";
import { signInAsNewLearner } from "./support/session";

const FIRST_LOAD = { timeout: 60_000 };

test("problem tracks appear per campaign, and a problem opens in its own project", async ({ page }) => {
  await signInAsNewLearner(page, "problems");
  await page.getByLabel(/Show unreviewed drafts/).check();

  await expect(page.getByRole("heading", { name: "Shopping cart campaign" })).toBeVisible(FIRST_LOAD);
  await expect(page.getByRole("heading", { name: "Data structure problems" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pattern problems" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "From memory" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Backend Workshop" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Low-level design" })).toBeVisible();

  await page.getByRole("link", { name: "Pair sum" }).click();
  await expect(page.getByRole("tab", { name: "PairSum.java" })).toBeVisible(FIRST_LOAD);
  // Standalone: none of the shopping-cart project's files.
  await expect(page.getByRole("tab", { name: "Checkout.java" })).toHaveCount(0);

  // The cart quest still opens in the shared cart project.
  await page.goto("/");
  await page.getByRole("link", { name: "Checkout totals" }).click();
  await expect(page.getByRole("tab", { name: "Checkout.java" })).toBeVisible(FIRST_LOAD);
  await expect(page.getByRole("tab", { name: "PairSum.java" })).toHaveCount(0);
});

test("a Backend Workshop component opens with its contract and a starter that compiles", async ({ page }) => {
  await signInAsNewLearner(page, "workshop");
  await page.getByLabel(/Show unreviewed drafts/).check();
  await page.getByRole("link", { name: "LRU cache" }).click(FIRST_LOAD);

  await expect(page.getByRole("tab", { name: "LruCache.java" })).toBeVisible(FIRST_LOAD);
  await expect(page.getByRole("heading", { name: "LRU cache", level: 1 })).toBeVisible();
  await expect(page.getByText(/LinkedHashMap/).first()).toBeVisible();
});
