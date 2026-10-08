import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync } from "fflate";
import { setEditorContent, signInAsNewLearner } from "./support/session";

// First visits compile pages on demand in `next dev` (the quest page bundles Monaco): allow for it.
test.setTimeout(180_000);
const FIRST_LOAD = { timeout: 60_000 };
const EDITED = "package shop;\n\n// edited before export\npublic class Checkout {\n}\n";

async function openFirstQuest(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel(/Show unreviewed drafts/).check();
  await page.getByRole("link", { name: "Checkout totals" }).click(FIRST_LOAD);
  await expect(page.getByRole("tab", { name: "Checkout.java" })).toBeVisible(FIRST_LOAD);
}

async function editorValue(page: Page, fileName: string): Promise<string | undefined> {
  await page.waitForFunction(() => Boolean((window as unknown as { monaco?: unknown }).monaco));
  return page.evaluate((name) => {
    const monaco = (window as unknown as { monaco: { editor: { getModels(): Array<{ uri: { path: string }; getValue(): string }> } } }).monaco;
    return monaco.editor.getModels().find((model) => model.uri.path.endsWith(`/${name}`))?.getValue();
  }, fileName);
}

test("a learner downloads an archive and a project ZIP, erases everything, and restores their code", async ({ page }) => {
  await signInAsNewLearner(page, "data");
  await openFirstQuest(page);
  await setEditorContent(page, "Checkout.java", EDITED);
  await expect(page.getByText("Checkout.java: Saved")).toBeVisible({ timeout: 15_000 });

  // Download both: the archive (signed JSON) and the project as a ZIP.
  await page.goto("/data");
  await expect(page.getByRole("heading", { name: "Your data", level: 1 })).toBeVisible(FIRST_LOAD);
  const [archiveDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download archive (.json)" }).click()]);
  const archivePath = await archiveDownload.path();
  const archive = JSON.parse(readFileSync(archivePath, "utf8"));
  expect([archiveDownload.suggestedFilename(), archive.format, archive.signature?.alg]).toEqual([
    expect.stringMatching(/^codequest-archive-\d{4}-\d{2}-\d{2}\.json$/),
    "codequest.archive",
    "HMAC-SHA256",
  ]);

  const [zipDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download ZIP" }).click()]);
  const zip = unzipSync(readFileSync(await zipDownload.path()));
  expect(new TextDecoder().decode(zip["shopping-cart/src/main/java/shop/Checkout.java"])).toBe(EDITED);

  // Erasing needs the typed phrase; the button stays disabled until it matches.
  const erase = page.getByRole("button", { name: "Erase everything" });
  await expect(erase).toBeDisabled();
  await page.getByLabel(/to confirm/).fill("delete my progress");
  await erase.click();
  await expect(page.getByText(/were erased/)).toBeVisible();
  await expect(page.getByText("No projects yet")).toBeVisible();

  // Restoring brings the project back; the same file again restores nothing new.
  await page.getByLabel("Archive file").setInputFiles(archivePath);
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByTestId("import-result")).toContainText("Restored 1 project, 1 project file.");
  await expect(page.getByRole("link", { name: "Download ZIP" })).toBeVisible();
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByTestId("import-result")).toContainText("Nothing new to restore");

  // The editor shows the restored code (local drafts were cleared by the erase, so this came
  // from the server).
  await openFirstQuest(page);
  expect(await editorValue(page, "Checkout.java")).toBe(EDITED);
});
