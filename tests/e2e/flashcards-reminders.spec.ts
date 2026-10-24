import { expect, test } from "@playwright/test";
import { expectNoViolations } from "./support/axe";
import { signInAsNewLearner } from "./support/session";

const FIRST_LOAD = { timeout: 60_000 };

test("a note becomes a flashcard in the learner's words, gets reviewed, and reminders respect consent", async ({ page }) => {
  await signInAsNewLearner(page, "cards");
  await page.getByLabel(/Show unreviewed drafts/).check();
  await page.getByRole("link", { name: "Build a stack" }).click(FIRST_LOAD);
  await expect(page.getByRole("tab", { name: "IntStack.java" })).toBeVisible(FIRST_LOAD);

  await page.getByLabel("Notes on this quest").fill("Doubling keeps push amortized O(1).");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Make a flashcard" }).click();
  await expect(page.getByLabel("Answer (your words; edit freely)")).toHaveValue("Doubling keeps push amortized O(1).");
  await page.getByLabel("Flashcard question").fill("Why does the array double?");
  await page.getByRole("button", { name: "Save flashcard" }).click();
  await expect(page.getByText("Flashcard saved.")).toBeVisible();

  // Reminders are off until the learner consents; then the home page shows a useful estimate.
  await page.goto("/");
  await expect(page.getByTestId("reminder")).toHaveCount(0, FIRST_LOAD);
  await page.goto("/progress");
  await page.getByLabel(/Gentle/).check();
  await page.getByLabel(/I'd like CodeQuest to remind me/).check();
  await page.getByLabel("Quiet from").fill("00:00");
  await page.getByLabel("until").fill("00:00");
  await page.getByRole("button", { name: "Save reminders" }).click();
  await expect(page.getByText("Saved.")).toBeVisible(FIRST_LOAD);
  await expectNoViolations(page, "progress with reminders");
  await page.goto("/");
  await expect(page.getByTestId("reminder")).toHaveText("1 flashcard ready for review, about 1 minute.", FIRST_LOAD);

  await page.goto("/flashcards");
  await expect(page.getByTestId("card-front")).toHaveText("Why does the array double?", FIRST_LOAD);
  await expectNoViolations(page, "flashcards");
  await page.getByRole("button", { name: "Show answer" }).click();
  await expect(page.getByTestId("card-back")).toHaveText("Doubling keeps push amortized O(1).");
  await page.getByRole("button", { name: "I knew it" }).click();
  await expect(page.getByTestId("no-cards-due")).toBeVisible();

  // Turning reminders off is one click.
  await page.goto("/progress");
  await page.getByRole("button", { name: "Turn reminders off" }).click();
  await expect(page.getByText("Saved.")).toBeVisible(FIRST_LOAD);
});
