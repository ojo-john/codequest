import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signInAsNewLearner } from "./support/session";

// Spec §47: automated accessibility checks on every main screen (WCAG 2.2 A/AA rules axe covers).
// Automated checks find a subset of problems; they complement, not replace, keyboard and
// screen-reader testing.
test.setTimeout(300_000);
const FIRST_LOAD = { timeout: 60_000 };
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectNoViolations(page: Page, screen: string): Promise<void> {
  // Monaco's own DOM is third-party; the workspace around it is still checked.
  const results = await new AxeBuilder({ page })
    .withTags(WCAG)
    .exclude(".monaco-editor")
    .analyze();
  const summary = results.violations.map(
    (violation) =>
      `${violation.id} (${violation.impact}): ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`,
  );
  expect(summary, `${screen} has accessibility violations`).toEqual([]);
  // Guard against a scan that silently checked nothing.
  expect(
    results.passes.length,
    `${screen}: axe evaluated no rules`,
  ).toBeGreaterThan(10);
}

test("sign-in screen has no detectable accessibility violations", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "CodeQuest" })).toBeVisible(
    FIRST_LOAD,
  );
  await expectNoViolations(page, "sign-in");
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`signed-in screens have no detectable accessibility violations (${colorScheme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await signInAsNewLearner(page, "a11y");
    await page.getByLabel(/Show unreviewed drafts/).check();
    await expect(
      page.getByRole("link", { name: "Checkout totals" }),
    ).toBeVisible(FIRST_LOAD);
    await expectNoViolations(page, "home");

    await page.getByRole("button", { name: "15 min" }).click();
    await expect(
      page.getByRole("heading", { name: "Your 15-minute session" }),
    ).toBeVisible(FIRST_LOAD);
    await expectNoViolations(page, "session");

    await page.getByRole("link", { name: "Start" }).first().click();
    await expect(page.getByRole("tab", { name: "Checkout.java" })).toBeVisible(
      FIRST_LOAD,
    );
    await expectNoViolations(page, "quest workspace");

    // States that appear after interaction: the new-test-file form and a results panel.
    await page.getByRole("button", { name: "＋ Test file" }).click();
    await expectNoViolations(page, "new test file form");
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: "Run samples" }).click();
    await expect(page.getByTestId("results")).toContainText("Some checks failed", { timeout: 180_000 });
    await expectNoViolations(page, "quest results");

    for (const [path, heading] of [
      ["/progress", "Progress"],
      ["/data", "Your data"],
      ["/usage", "Usage"],
    ] as const) {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { name: heading, level: 1 }),
      ).toBeVisible(FIRST_LOAD);
      await expectNoViolations(page, path);
    }
  });
}
