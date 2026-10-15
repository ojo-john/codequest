import { expect, test } from "@playwright/test";
import { expectNoViolations } from "./support/axe";
import { signInAsNewLearner } from "./support/session";

const FIRST_LOAD = { timeout: 60_000 };

test("a mock interview: plan, code with hints off (server-enforced), finish, and an honest result", async ({ page }) => {
  await signInAsNewLearner(page, "mock");
  await page.getByLabel(/Show unreviewed drafts/).check();
  await expect(page.getByRole("link", { name: "Checkout totals" })).toBeVisible(FIRST_LOAD);

  await page.goto("/mock");
  await page.getByRole("button", { name: "Start a 45-minute coding mock" }).click();
  await expect(page.getByRole("timer", { name: "Time remaining" })).toHaveText(/^4[45]:\d\d$/, FIRST_LOAD);

  await page.getByLabel("Clarify").fill("Can the input be empty? What should be returned when nothing matches?");
  await expect(page.locator("#plan-status")).toHaveText("Saved", { timeout: 15_000 });
  await expectNoViolations(page, "mock room (plan)");

  // Study aids are off in the UI and refused by the server.
  await page.getByRole("tab", { name: "Code" }).click();
  await expect(page.getByRole("button", { name: "Submit" })).toBeVisible(FIRST_LOAD);
  await expect(page.getByRole("heading", { name: "Hints" })).toHaveCount(0);
  await expectNoViolations(page, "mock room (code)");
  const { running } = (await (await page.request.get("/api/v1/mocks")).json()) as { running: { problem: { contentVersionId: string } } };
  const hint = await page.request.post(`/api/v1/quests/${running.problem.contentVersionId}/hints`);
  expect([hint.status(), ((await hint.json()) as { error: { code: string } }).error.code]).toEqual([409, "mock_in_progress"]);

  // A reload keeps the plan.
  await page.reload();
  await expect(page.getByLabel("Clarify")).toHaveValue(/input be empty/, FIRST_LOAD);

  await page.getByRole("button", { name: "Finish interview" }).click();
  await page.getByRole("button", { name: "Yes, finish" }).click();
  await expect(page.getByRole("heading", { name: "Mock interview result" })).toBeVisible(FIRST_LOAD);
  await expect(page.getByText("Needs more practice")).toBeVisible();
  await expect(page.getByText(/not a prediction of any employer's hiring decision/)).toBeVisible();
  await expectNoViolations(page, "mock result");

  // Afterwards the problem's hints are available again.
  const after = await page.request.post(`/api/v1/quests/${running.problem.contentVersionId}/hints`);
  expect(after.status()).toBe(200);
});
