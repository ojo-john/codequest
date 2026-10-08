import { expect, test } from "@playwright/test";
import { signInAsNewLearner } from "./support/session";

test("the usage screen shows the execution allowance and the database size", async ({ page }) => {
  await signInAsNewLearner(page, "usage");

  await page.getByRole("link", { name: "Usage" }).click();

  await expect(page.getByRole("heading", { name: "Usage", level: 1 })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("meter", { name: "Code runs today" })).toHaveAttribute("aria-valuemax", "100");
  await expect(page.getByRole("meter", { name: "Code runs this month" })).toHaveAttribute("aria-valuemax", "2000");
  await expect(page.getByRole("meter", { name: "Compute time this month" })).toBeVisible();
  await expect(page.getByRole("meter", { name: "Database" })).toHaveAttribute("aria-valuetext", /MB of 500 MB/);
});
