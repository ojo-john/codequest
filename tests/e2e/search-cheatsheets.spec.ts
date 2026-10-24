import { expect, test } from "@playwright/test";
import { expectNoViolations } from "./support/axe";
import { signInAsNewLearner } from "./support/session";

const FIRST_LOAD = { timeout: 60_000 };

test("search finds skills, problems and cheat sheets; cheat sheets open with sources and hide during a mock", async ({ page }) => {
  await signInAsNewLearner(page, "search");
  await page.getByLabel(/Show unreviewed drafts/).check();
  await expect(page.getByRole("link", { name: "Build a stack" })).toBeVisible(FIRST_LOAD);

  await page.getByRole("searchbox", { name: "Search" }).fill("BFS");
  await page.getByRole("searchbox", { name: "Search" }).press("Enter");
  await expect(page.getByRole("heading", { name: "Results for “BFS”" })).toBeVisible(FIRST_LOAD);
  const results = page.getByTestId("search-results");
  await expect(results.getByRole("link", { name: "From memory: BFS" })).toBeVisible();
  await expect(results.getByRole("link", { name: "Graphs" })).toBeVisible();
  await expectNoViolations(page, "search results");

  await results.getByRole("link", { name: "Graphs" }).click();
  await expect(page.getByRole("heading", { name: "Graphs", level: 1 })).toBeVisible(FIRST_LOAD);
  await expect(page.getByText(/Version 1, updated .* Sources: Cormen/)).toBeVisible();
  await expectNoViolations(page, "cheat sheet");

  // A mock interview hides cheat sheets, as a real interview would.
  await page.goto("/mock");
  await page.getByRole("button", { name: "Start a 45-minute coding mock" }).click();
  await expect(page.getByRole("timer", { name: "Time remaining" })).toBeVisible(FIRST_LOAD);
  await page.goto("/cheatsheets/graphs");
  await expect(page.getByText("Cheat sheets are hidden while your mock interview runs.")).toBeVisible(FIRST_LOAD);
  await page.goto("/search?q=BFS");
  await expect(page.getByText("Cheat sheets and notes are left out while your mock interview runs.")).toBeVisible(FIRST_LOAD);
  await expect(page.getByTestId("search-results").getByRole("link", { name: "Graphs" })).toHaveCount(0);
});
