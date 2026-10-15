import { expect, test } from "@playwright/test";
import { answerAnything } from "./support/exercises";
import { signInAsNewLearner } from "./support/session";

const FIRST_LOAD = { timeout: 60_000 };

test("a design challenge: write sections that save, answer the follow-ups, then self-review", async ({ page }) => {
  await signInAsNewLearner(page, "design");
  await page.getByLabel(/Show unreviewed drafts/).check();
  await expect(page.getByRole("link", { name: "Build a stack" })).toBeVisible(FIRST_LOAD);
  await page.goto("/practice");
  await page.getByRole("link", { name: "Design a URL shortener" }).click(FIRST_LOAD);

  await expect(page.getByRole("heading", { name: "Design a URL shortener", level: 1 })).toBeVisible(FIRST_LOAD);
  const api = page.getByLabel("API");
  await api.fill("# API\n\nPOST /links {url} -> {code}\nGET /{code} -> 302");
  // Every untouched section already reads "Saved"; wait for this one's own save to finish.
  await expect(page.locator("#design-api-status")).toHaveText("Saved", { timeout: 15_000 });

  // The design is kept in its own project: it survives a reload.
  await page.reload();
  await expect(page.getByLabel("API")).toHaveValue(/POST \/links/, FIRST_LOAD);

  // Self-review is only revealed after the follow-ups.
  await page.getByRole("button", { name: /I'm done/ }).click();
  const total = Number((await page.getByText(/Question 1 of \d+/).textContent())?.match(/of (\d+)/)?.[1]);
  for (let index = 1; index <= total; index++) {
    await answerAnything(page);
    await page.getByRole("button", { name: index < total ? "Next question" : "Finish" }).click();
  }
  await expect(page.getByRole("heading", { name: "Self-review" })).toBeVisible();
  await expect(page.getByText(/short-code scheme that avoids collisions/)).toBeVisible();
});
