import { expect, test } from "@playwright/test";
import { signInAsNewLearner } from "./support/session";

const FIRST_LOAD = { timeout: 60_000 };

test("a new learner is pointed to Base Camp, the check adapts after two misses, and placement suggests where to start", async ({ page }) => {
  await signInAsNewLearner(page, "camp");
  await page.getByLabel(/Show unreviewed drafts/).check();
  // The opt-in saves asynchronously; wait until drafts show before reloading.
  await expect(page.getByRole("link", { name: "Build a stack" })).toBeVisible(FIRST_LOAD);
  await page.reload();
  await page.getByRole("link", { name: "Go to Base Camp" }).click(FIRST_LOAD);
  await page.getByRole("link", { name: "Start the check" }).click(FIRST_LOAD);

  // Java section: two wrong answers in a row end the section early.
  await expect(page.getByText("Java · 0 answered so far")).toBeVisible(FIRST_LOAD);
  await page.getByLabel("True", { exact: true }).check();
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText("✗ Not this time")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Returns null").check();
  await page.getByRole("button", { name: "Check" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  // The next question comes from the Big-O section.
  await expect(page.getByText("Big-O · 2 answered so far")).toBeVisible();
  await page.getByLabel("O(n)", { exact: true }).check();
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText("✓ Correct")).toBeVisible();
});

test("Base Camp shows placement per area once answers exist", async ({ page }) => {
  await signInAsNewLearner(page, "placed");
  await page.getByLabel(/Show unreviewed drafts/).check();
  // The opt-in saves asynchronously; wait until drafts show before navigating away.
  await expect(page.getByRole("link", { name: "Build a stack" })).toBeVisible(FIRST_LOAD);
  await page.goto("/base-camp?run=1");
  await page.getByLabel("False", { exact: true }).check(FIRST_LOAD);
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText("✓ Correct")).toBeVisible();

  await page.goto("/base-camp");
  await expect(page.getByRole("heading", { name: "Your placement" })).toBeVisible(FIRST_LOAD);
  await expect(page.getByText("1 of 1 correct")).toBeVisible();
  await expect(page.getByText("Not reached").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Maps and counting" })).toBeVisible();
});
