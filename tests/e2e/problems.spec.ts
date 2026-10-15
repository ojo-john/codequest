import { expect, test } from "@playwright/test";
import { signInAsNewLearner } from "./support/session";

const FIRST_LOAD = { timeout: 60_000 };

test("problem tracks appear per campaign (the removed shopping cart doesn't), and each problem opens in its own project", async ({ page }) => {
  await signInAsNewLearner(page, "problems");
  await page.getByLabel(/Show unreviewed drafts/).check();

  await expect(page.getByRole("heading", { name: "Data structure problems" })).toBeVisible(FIRST_LOAD);
  await expect(page.getByRole("heading", { name: "Pattern problems" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "From memory" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Backend Workshop" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Low-level design" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Shopping cart campaign" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Checkout totals" })).toHaveCount(0);

  await page.getByRole("link", { name: "Pair sum" }).click();
  await expect(page.getByRole("tab", { name: "PairSum.java" })).toBeVisible(FIRST_LOAD);
  await expect(page.getByRole("tab", { name: "IntStack.java" })).toHaveCount(0);

  // Another problem has its own project: none of Pair sum's files.
  await page.goto("/");
  await page.getByRole("link", { name: "Build a stack" }).click();
  await expect(page.getByRole("tab", { name: "IntStack.java" })).toBeVisible(FIRST_LOAD);
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
