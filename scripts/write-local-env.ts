import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/**
 * Writes .env.development.local from the LOCAL Supabase stack (`npm run db:start`), so the dev
 * server talks to the local database. The values are the stack's well-known demo keys, plus a
 * development-only archive signing key that is kept across runs (so local archives stay
 * restorable) and never used anywhere else.
 *
 *   npm run db:env
 */
const raw = execFileSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "ignore"] });
const status = JSON.parse(raw.slice(raw.indexOf("{"))) as Record<string, string>;
const host = new URL(status.API_URL).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing to write local env for non-local API ${host}`);

const ENV_FILE = ".env.development.local";
const existingKey = existsSync(ENV_FILE) ? /^ARCHIVE_SIGNING_KEY=(.+)$/m.exec(readFileSync(ENV_FILE, "utf8"))?.[1] : undefined;
const archiveSigningKey = existingKey ?? randomBytes(32).toString("base64");

writeFileSync(
  ENV_FILE,
  [
    "# Local development points at the LOCAL Supabase stack (npm run db:start). Values are the",
    "# stack's well-known demo keys. Git-ignored; regenerate with `npm run db:env`.",
    `NEXT_PUBLIC_SUPABASE_URL=${status.API_URL}`,
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${status.PUBLISHABLE_KEY}`,
    `SUPABASE_URL=${status.API_URL}`,
    `SUPABASE_SECRET_KEY=${status.SECRET_KEY}`,
    "# Development-only key for signing progress archives (lib/archive). Not the production key.",
    `ARCHIVE_SIGNING_KEY=${archiveSigningKey}`,
    "",
  ].join("\n"),
  { mode: 0o600 },
);
console.log("Wrote .env.development.local for the local Supabase stack.");
