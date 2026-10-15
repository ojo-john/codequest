import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

export async function expectNoViolations(page: Page, screen: string): Promise<void> {
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
