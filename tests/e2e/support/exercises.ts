import type { Page } from "@playwright/test";

/** Gives any valid answer to the question on screen (right or wrong doesn't matter here). */
export async function answerAnything(page: Page): Promise<void> {
  const output = page.getByLabel("Exact output");
  const blank = page.getByLabel("Blank 1");
  if (await output.count()) await output.fill("?");
  else if (await blank.count()) {
    for (const input of await page.getByLabel(/^Blank \d+$/).all()) await input.fill("x");
  } else if (await page.getByRole("radio").count()) await page.getByRole("radio").first().check();
  else if (await page.getByRole("checkbox").count()) await page.getByRole("checkbox").first().check();
  // Ordering questions start in a complete (if wrong) order.
  await page.getByRole("button", { name: "Check" }).click();
}
