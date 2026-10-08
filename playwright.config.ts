import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the dev server and the LOCAL Supabase stack (npm run db:start),
 * which includes a mail catcher for sign-in links.
 */
const BASE_URL = "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // npm run dev (not next dev) so predev copies Monaco's assets into public/monaco.
    command: "npm run dev -- --hostname 127.0.0.1 --port 3000",
    url: `${BASE_URL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
