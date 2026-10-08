import { expect, test } from "@playwright/test";
import { createAccount, messagesTo, waitForSignInLink } from "./support/mailbox";

const uniqueEmail = (label: string) => `${label}-${crypto.randomUUID().slice(0, 8)}@codequest.test`;

test("signed-out visitor is sent to sign-in, keeping the destination", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/login\?next=%2F$/);
});

test("owner signs in with an emailed link, lands on home, and signs out", async ({ page }) => {
  const email = uniqueEmail("owner");
  await createAccount(email);

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("status")).toContainText("Check your email");

  await page.goto(await waitForSignInLink(email));
  await expect(page.getByTestId("signed-in-email")).toHaveText(email);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});

test("unknown address gets the same response and no email (no account discovery, no sign-up)", async ({ page }) => {
  const email = uniqueEmail("stranger");

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();

  await expect(page.getByRole("status")).toContainText("Check your email");
  await page.waitForTimeout(2_000);
  expect(await messagesTo(email)).toHaveLength(0);
});

test("invalid email is rejected inline", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("not-an-email");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();

  await expect(page.locator("#sign-in-message")).toContainText("valid email");
});

test("a forged or reused callback code shows a recoverable error", async ({ page }) => {
  await page.goto("/auth/callback?code=forged-code&next=%2F");

  await expect(page).toHaveURL(/\/auth\/error\?reason=link_invalid/);
  await expect(page.getByRole("link", { name: "Request a new link" })).toBeVisible();
});

test("an off-site next parameter can't redirect after sign-in", async ({ page }) => {
  const email = uniqueEmail("redirect");
  await createAccount(email);

  await page.goto("/login?next=%2F%2Fevil.example%2Fphish");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await page.goto(await waitForSignInLink(email));

  await expect(page).toHaveURL("http://127.0.0.1:3000/");
});
