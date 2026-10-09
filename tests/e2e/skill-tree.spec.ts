import { expect, test } from "@playwright/test";
import { signInAsNewLearner } from "./support/session";

const FIRST_LOAD = { timeout: 60_000 };

test("the skill tree lists every world, marks unavailable ones, and opens a skill's detail", async ({ page }) => {
  await signInAsNewLearner(page, "tree");
  await page.getByLabel(/Show unreviewed drafts/).check();
  await page.getByRole("link", { name: "Skills" }).click();

  await expect(page.getByRole("heading", { name: "World 0: Base Camp" })).toBeVisible(FIRST_LOAD);
  await expect(page.getByRole("heading", { name: "World 10: Mastery League" })).toBeVisible();
  await expect(page.getByText("Coming later").first()).toBeVisible();

  // The graph view is there for sighted users; each node is a link.
  await page.getByText("Show as a graph").click();
  await expect(page.getByRole("link", { name: "Sliding window, not started" })).toBeVisible();

  await page.getByRole("link", { name: "Sliding window", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sliding window", level: 1 })).toBeVisible(FIRST_LOAD);
  await expect(page.getByText("Loop analysis — required first")).toBeVisible();
  await expect(page.getByText("Collections — suggested order")).toBeVisible();
  await expect(page.getByRole("link", { name: "Maps and counting" })).toBeVisible();
});
