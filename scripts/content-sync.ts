import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { parseArgs } from "node:util";
import postgres from "postgres";
import { loadContent } from "../lib/content/repository";
import { syncContent } from "../lib/content/sync";

/**
 * Loads repository content into a database (one transaction; see lib/content/sync.ts).
 *
 *   npm run content:sync                      # local stack
 *   npm run content:sync -- --target cloud    # uses SUPABASE_DB_URL (owner-run)
 *
 * Run `npm run content:check` first: sync trusts the content gate for correctness.
 */

const CONTENT_ROOT = join(import.meta.dirname, "..", "content");

function localDbUrl(): string {
  const raw = execFileSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "ignore"] });
  return (JSON.parse(raw.slice(raw.indexOf("{"))) as { DB_URL: string }).DB_URL;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { target: { type: "string", default: "local" } } });
  let dbUrl: string;
  if (values.target === "local") {
    dbUrl = localDbUrl();
  } else if (values.target === "cloud") {
    if (!process.env.SUPABASE_DB_URL) throw new Error("set SUPABASE_DB_URL for --target cloud");
    dbUrl = process.env.SUPABASE_DB_URL;
  } else {
    throw new Error("--target must be local or cloud");
  }

  const sql = postgres(dbUrl, { max: 1, connect_timeout: 15, idle_timeout: 5, onnotice: () => {} });
  try {
    const report = await syncContent(sql, loadContent(CONTENT_ROOT));
    console.log(`Synced to ${values.target}: ${report.skills} skills; inserted ${report.inserted.length}, updated ${report.updated.length}, unchanged ${report.unchanged.length}.`);
    for (const label of [...report.inserted, ...report.updated]) console.log(`  changed: ${label}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
