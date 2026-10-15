import { expect, test } from "@playwright/test";
import { expectNoViolations } from "./support/axe";
import { signInAsNewLearner } from "./support/session";

const FIRST_LOAD = { timeout: 60_000 };

test("a learner writes a STAR story, sees structure checks update, finds it for matching questions, then deletes it", async ({ page }) => {
  await signInAsNewLearner(page, "stories");
  await page.goto("/stories");
  await expect(page.getByRole("heading", { name: "Behavioral stories" })).toBeVisible(FIRST_LOAD);
  await expect(page.getByText("0 of 11 competencies have a story.")).toBeVisible();
  await expectNoViolations(page, "stories");

  await page.getByRole("button", { name: "Add a story" }).click();
  await expect(page.getByRole("heading", { name: "Your story" })).toBeVisible(FIRST_LOAD);
  await expect(page.getByText("Action: Describe the steps you took.")).toBeVisible();

  await page.getByLabel("Title").fill("Pushing back on a risky launch");
  await page.getByLabel("Disagreement").check();
  await page.getByLabel("Action").fill("I gathered the error rates from staging, I wrote a one-page risk summary, and I proposed a one-week delay with a rollback plan.");
  await expect(page.locator("#story-status")).toHaveText("Saved", { timeout: 15_000 });
  await expect(page.getByText("Action is there.")).toBeVisible();
  await expectNoViolations(page, "story editor");

  // A reload shows what was saved.
  await page.reload();
  await expect(page.getByLabel("Title")).toHaveValue("Pushing back on a risky launch", FIRST_LOAD);

  await page.getByRole("link", { name: "← All stories" }).click();
  await expect(page.getByText("1 of 11 competencies have a story.")).toBeVisible(FIRST_LOAD);
  const question = page.getByRole("listitem").filter({ hasText: "disagreed with your manager" });
  await expect(question.getByRole("link", { name: "Pushing back on a risky launch" })).toBeVisible();

  await page.getByRole("link", { name: "Pushing back on a risky launch" }).first().click();
  await page.getByRole("button", { name: "Delete story" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("No stories yet.")).toBeVisible(FIRST_LOAD);
});
