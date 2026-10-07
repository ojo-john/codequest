import { expect, type Page } from "@playwright/test";
import { createAccount, waitForSignInLink } from "./mailbox";

/** Creates a fresh account and signs this page in through the real magic-link flow. */
export async function signInAsNewLearner(page: Page, label: string): Promise<string> {
  const email = `${label}-${crypto.randomUUID().slice(0, 8)}@codequest.test`;
  await createAccount(email);
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("status")).toContainText("Check your email");
  await page.goto(await waitForSignInLink(email));
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  return email;
}

/** Replaces a file's content through Monaco's API (typing would trigger auto-indent/auto-close). */
export async function setEditorContent(page: Page, fileName: string, source: string): Promise<void> {
  await page.getByRole("tab", { name: fileName }).click();
  await page.waitForFunction(() => Boolean((window as unknown as { monaco?: unknown }).monaco));
  await page.evaluate(
    ({ name, text }) => {
      const monaco = (window as unknown as { monaco: { editor: { getModels(): Array<{ uri: { path: string }; setValue(v: string): void }> } } }).monaco;
      const model = monaco.editor.getModels().find((candidate) => candidate.uri.path.endsWith(`/${name}`));
      if (!model) throw new Error(`no editor model for ${name}`);
      model.setValue(text);
    },
    { name: fileName, text: source },
  );
}
