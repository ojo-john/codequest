import { expect, test } from "@playwright/test";
import { expectNoViolations } from "./support/axe";
import { signInAsNewLearner } from "./support/session";

const FIRST_LOAD = { timeout: 60_000 };
test.use({ timezoneId: "Europe/Paris" });

test("streak card: supportive copy, device time zone, a busy week scheduled and cancelled, achievements", async ({ page }) => {
  await signInAsNewLearner(page, "streaks");
  await expect(page.getByTestId("home-streak")).toContainText("of practice today starts a streak", FIRST_LOAD);

  await page.goto("/progress");
  await expect(page.getByRole("heading", { name: "Streak" })).toBeVisible(FIRST_LOAD);
  await expect(page.getByTestId("streak-current")).toHaveText("0 days");
  await expect(page.getByText("Freezes left")).toBeVisible();

  // New profiles count days in UTC; one click switches to this device's zone.
  await page.getByRole("button", { name: "Use this device's (Europe/Paris)" }).click();
  await expect(page.getByText("Europe/Paris", { exact: true })).toBeVisible(FIRST_LOAD);

  await page.getByLabel("Pause").selectOption("busy_week");
  await page.getByRole("button", { name: "Add pause" }).click();
  await expect(page.getByText("Busy week", { exact: true }).last()).toBeVisible(FIRST_LOAD);
  await expect(page.getByTestId("streak-message")).toContainText("2 minutes");
  await expectNoViolations(page, "progress with streak and achievements");

  await page.getByRole("button", { name: "End now" }).click();
  await expect(page.getByRole("button", { name: "End now" })).toHaveCount(0, FIRST_LOAD);

  await expect(page.getByRole("heading", { name: "Achievements" })).toBeVisible();
  await expect(page.getByText("Complexity Detective")).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Speedrunner progress" })).toBeVisible();
});
