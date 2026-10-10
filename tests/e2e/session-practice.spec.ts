import { expect, test } from "@playwright/test";
import { answerAnything } from "./support/exercises";
import { signInAsNewLearner } from "./support/session";

const FIRST_LOAD = { timeout: 60_000 };

test("a 5-minute session is a practice set; finishing every question completes the session", async ({ page }) => {
  await signInAsNewLearner(page, "flash");
  await page.getByLabel(/Show unreviewed drafts/).check();
  await page.getByRole("button", { name: "5 min", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your 5-minute session" })).toBeVisible(FIRST_LOAD);
  await expect(page.getByRole("listitem").getByText("Practice", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Start" }).click();

  const total = Number((await page.getByText(/Question 1 of \d+/).textContent(FIRST_LOAD))?.match(/of (\d+)/)?.[1]);
  for (let index = 1; index <= total; index++) {
    await expect(page.getByText(`Question ${index} of ${total}`)).toBeVisible();
    await answerAnything(page);
    await page.getByRole("button", { name: index < total ? "Next question" : "Finish" }).click();
  }

  await expect(page.getByText("🎉 Session complete.")).toBeVisible();
  await page.getByRole("link", { name: "Back to session" }).click();
  await expect(page.getByText("Session complete. Nice work.")).toBeVisible(FIRST_LOAD);
});
