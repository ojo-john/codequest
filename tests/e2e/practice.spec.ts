import { expect, test } from "@playwright/test";
import { signInAsNewLearner } from "./support/session";

const FIRST_LOAD = { timeout: 60_000 };

test("a learner works through an exercise set: right, wrong, ordering, blanks and Big-O", async ({ page }) => {
  await signInAsNewLearner(page, "practice");
  await page.getByLabel(/Show unreviewed drafts/).check();
  await page.getByRole("link", { name: "Practice" }).click();
  await page.getByRole("link", { name: "Maps and counting" }).click(FIRST_LOAD);
  await expect(page.getByText("Question 1 of 9")).toBeVisible(FIRST_LOAD);

  // 1. Right answer: XP, explanation.
  await page.getByLabel("0", { exact: true }).check();
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText("✓ Correct")).toBeVisible();
  await expect(page.getByText("+5 XP")).toBeVisible();
  await page.getByRole("button", { name: "Next question" }).click();

  // 2. Predict output, wrong: the canonical output is shown.
  await page.getByLabel("Exact output").fill("{a=3, b=1, n=3}");
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText("✗ Not this time")).toBeVisible();
  await expect(page.getByText("{a=3, b=1, n=2}")).toBeVisible();
  await page.getByRole("button", { name: "Next question" }).click();

  // 3. Fill in the blank.
  await page.getByLabel("Blank 1").fill("getOrDefault");
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText("✓ Correct")).toBeVisible();
  await page.getByRole("button", { name: "Next question" }).click();

  // 4. Ordering with keyboard-accessible buttons: shown order is [return, create, store, turn into chars].
  await page.getByRole("button", { name: 'Move "Return the map" down' }).click();
  await page.getByRole("button", { name: 'Move "Return the map" down' }).click();
  await page.getByRole("button", { name: 'Move "Return the map" down' }).click();
  await page.getByRole("button", { name: 'Move "Turn the String into its characters" up' }).click();
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText("✓ Correct")).toBeVisible();
  await page.getByRole("button", { name: "Next question" }).click();

  // 5–6: skip ahead with answers; 7: Big-O.
  await page.getByLabel("HashMap.get(key)").check();
  await page.getByLabel("HashSet.contains(x)").check();
  await page.getByRole("button", { name: "Check" }).click();
  await page.getByRole("button", { name: "Next question" }).click();
  await page.getByLabel("False", { exact: true }).check();
  await page.getByRole("button", { name: "Check" }).click();
  await page.getByRole("button", { name: "Next question" }).click();
  await page.getByLabel("O(n^2)").check();
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText("✓ Correct")).toBeVisible();

  // Progress shows the new skill dimensions.
  await page.goto("/progress");
  await expect(page.getByRole("row", { name: /^Loop analysis complexity/ })).toBeVisible(FIRST_LOAD);
});

test("mixed practice hides where each question comes from", async ({ page }) => {
  await signInAsNewLearner(page, "mixed");
  await page.getByLabel(/Show unreviewed drafts/).check();
  // The opt-in saves asynchronously; wait until drafts show before navigating away.
  await expect(page.getByRole("link", { name: "Checkout totals" })).toBeVisible(FIRST_LOAD);
  await page.goto("/practice");
  await page.getByRole("link", { name: "Start mixed practice" }).click(FIRST_LOAD);

  await expect(page.getByText("Challenge 1 of 8")).toBeVisible(FIRST_LOAD);
  await expect(page.getByText(/Maps and counting|Loop detective|Strings essentials/)).toHaveCount(0);
});
