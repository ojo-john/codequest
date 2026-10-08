import { expect, test } from "@playwright/test";
import { setEditorContent, signInAsNewLearner } from "./support/session";

// Runs real Java in the local Docker runner (emulated amd64 on Apple Silicon is slow).
test.setTimeout(300_000);
const FIRST_LOAD = { timeout: 60_000 };

const FAILING_TEST = `package shop;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class CheckoutTest {

    @Test
    void lineTotalMultipliesPriceByQuantity() {
        assertEquals(750, Checkout.lineTotalCents(250, 3));
    }
}
`;

test("a learner adds a JUnit test file, runs it, and sees their own test results apart from the samples", async ({ page }) => {
  await signInAsNewLearner(page, "tests");
  await page.getByLabel(/Show unreviewed drafts/).check();
  await page.getByRole("link", { name: "Checkout totals" }).click();
  await expect(page.getByRole("tab", { name: "Checkout.java" })).toBeVisible(FIRST_LOAD);

  // The test class is created next to the code it tests, named after it.
  await page.getByRole("button", { name: "＋ Test file" }).click();
  await expect(page.getByLabel("Test class name")).toHaveValue("CheckoutTest");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("tab", { name: "CheckoutTest.java" })).toBeVisible();

  // Against the untouched starter (returns 0), the learner's own test fails, reported separately.
  await setEditorContent(page, "CheckoutTest.java", FAILING_TEST);
  await expect(page.getByText("CheckoutTest.java: Saved")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Run samples" }).click();
  await expect(page.getByTestId("results")).toContainText("Some checks failed", { timeout: 180_000 });
  await expect(page.getByRole("region", { name: "Your tests" })).toContainText("Your tests: 1 of 1 failed.");
  await expect(page.getByRole("region", { name: "Your tests" })).toContainText("lineTotalMultipliesPriceByQuantity()");

  // The new file was saved to the project: it is still there after a reload.
  await page.reload();
  await expect(page.getByRole("tab", { name: "CheckoutTest.java" })).toBeVisible(FIRST_LOAD);
});
