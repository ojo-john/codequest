import { execFileSync } from "node:child_process";

/** The local stack's mail catcher (Mailpit). Never points anywhere but loopback. */
const MAILPIT_URL = "http://127.0.0.1:54324";
const REQUEST_TIMEOUT_MS = 5_000;

interface MailpitMessageSummary {
  readonly ID: string;
  readonly To: ReadonlyArray<{ readonly Address: string }>;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${MAILPIT_URL}${path}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`mailpit ${path} -> ${response.status}`);
  return (await response.json()) as T;
}

export async function messagesTo(address: string): Promise<MailpitMessageSummary[]> {
  const search = await getJson<{ messages: MailpitMessageSummary[] }>(`/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`);
  return search.messages;
}

/** Waits for the sign-in email to `address` and returns the link it contains. */
export async function waitForSignInLink(address: string, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [message] = await messagesTo(address);
    if (message) {
      const full = await getJson<{ HTML: string; Text: string }>(`/api/v1/message/${message.ID}`);
      const href = /href="([^"]+)"/.exec(full.HTML)?.[1] ?? /(https?:\/\/\S+)/.exec(full.Text)?.[1];
      if (!href) throw new Error("sign-in email contained no link");
      return href.replaceAll("&amp;", "&");
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`no sign-in email for ${address} within ${timeoutMs} ms`);
}

/** Creates a confirmed account with the local stack's admin key (sign-ups are disabled). */
export async function createAccount(email: string): Promise<void> {
  const raw = execFileSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8", timeout: 30_000 });
  const status = JSON.parse(raw.slice(raw.indexOf("{"))) as { API_URL: string; SERVICE_ROLE_KEY: string };
  if (!["127.0.0.1", "localhost"].includes(new URL(status.API_URL).hostname)) throw new Error("refusing non-local Supabase");
  const response = await fetch(`${status.API_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: status.SERVICE_ROLE_KEY, authorization: `Bearer ${status.SERVICE_ROLE_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ email, email_confirm: true }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`create account -> ${response.status} ${await response.text()}`);
}
