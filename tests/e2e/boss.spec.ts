import { expect, test } from "@playwright/test";
import { answerAnything } from "./support/exercises";
import { signInAsNewLearner } from "./support/session";

const FIRST_LOAD = { timeout: 60_000 };

test("a mastery exam judges every section on its own and suggests practice for the weak ones", async ({ page }) => {
  await signInAsNewLearner(page, "boss");
  await page.getByLabel(/Show unreviewed drafts/).check();
  // The opt-in saves asynchronously; wait until drafts show before navigating away.
  await expect(page.getByRole("link", { name: "Checkout totals" })).toBeVisible(FIRST_LOAD);
  await page.goto("/practice");
  await page.getByRole("link", { name: "Complexity Caverns exam" }).click(FIRST_LOAD);

  const total = Number((await page.getByText(/Question 1 of \d+/).textContent(FIRST_LOAD))?.match(/of (\d+)/)?.[1]);
  for (let index = 1; index <= total; index++) {
    await expect(page.getByText(`Question ${index} of ${total}`)).toBeVisible();
    await answerAnything(page);
    await page.getByRole("button", { name: index < total ? "Next question" : "Finish" }).click();
  }

  // Guessing the first option everywhere won't pass; each section reports on its own.
  await expect(page.getByText("Not passed yet")).toBeVisible();
  await expect(page.getByText("Each section needs 70% on its own")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Recursion and space" }).getByText(/Passed|Not yet/)).toBeVisible();
  await expect(page.getByText("Practise:").first()).toBeVisible();
});
