import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { setEditorContent, signInAsNewLearner } from "./support/session";

// Runs real Java in the local Docker runner (emulated amd64 on Apple Silicon is slow).
test.setTimeout(300_000);
// First visits compile pages on demand in `next dev` (the quest page bundles Monaco): allow for it.
const FIRST_LOAD = { timeout: 60_000 };

const REFERENCE = readFileSync(
  join(process.cwd(), "content", "private", "cart.q1-checkout-totals", "reference", "src", "main", "java", "shop", "Checkout.java"),
  "utf8",
);

test("a learner opts into drafts, runs, gets a hint, submits a correct solution and keeps their code", async ({ page }) => {
  await signInAsNewLearner(page, "loop");

  // Nothing is published yet; drafts appear only after an explicit, labelled opt-in.
  await expect(page.getByText("No published content yet")).toBeVisible();
  await page.getByLabel(/Show unreviewed drafts/).check();
  await expect(page.getByRole("link", { name: "Checkout totals" })).toBeVisible(FIRST_LOAD);
  await expect(page.getByText("Unreviewed draft").first()).toBeVisible();

  // A 15-minute session continues the campaign at quest 1.
  await page.getByRole("button", { name: "15 min" }).click();
  await expect(page.getByRole("heading", { name: "Your 15-minute session" })).toBeVisible(FIRST_LOAD);
  await page.getByRole("link", { name: "Start" }).first().click();
  await expect(page.getByRole("heading", { name: "Checkout totals", level: 1 })).toBeVisible(FIRST_LOAD);
  await expect(page.getByRole("tab", { name: "Checkout.java" })).toBeVisible(FIRST_LOAD);

  // The untouched starter compiles but fails the visible samples.
  await page.getByRole("button", { name: "Run samples" }).click();
  await expect(page.getByTestId("results")).toContainText("Some checks failed", { timeout: 180_000 });
  await expect(page.getByTestId("results")).toContainText("expected 750");

  await page.getByRole("button", { name: "Show a hint" }).click();
  await expect(page.getByText(/check each argument against the rules/)).toBeVisible();

  // A correct solution passes every hidden check; XP is awarded (hinted: no bonus, no penalty).
  await setEditorContent(page, "Checkout.java", REFERENCE);
  await expect(page.getByText("Checkout.java: Saved")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByTestId("results")).toContainText("All checks passed", { timeout: 180_000 });
  await expect(page.getByTestId("results")).toContainText("+30 XP");

  // The code was saved to the project: a reload brings it back from the server.
  await page.reload();
  await page.waitForFunction(() => Boolean((window as unknown as { monaco?: unknown }).monaco));
  const restored = await page.evaluate(() => {
    const monaco = (window as unknown as { monaco: { editor: { getModels(): Array<{ uri: { path: string }; getValue(): string }> } } }).monaco;
    return monaco.editor.getModels().find((model) => model.uri.path.endsWith("/Checkout.java"))?.getValue();
  });
  expect(restored).toBe(REFERENCE);
  await expect(page.getByTestId("results")).toContainText("All checks passed");

  // Home shows the XP and the quest as done; progress shows the evidence.
  await page.goto("/");
  await expect(page.getByTestId("xp-total")).toHaveText("30");
  await page.goto("/progress");
  await expect(page.getByRole("cell", { name: "Loops" })).toBeVisible(FIRST_LOAD);
});
