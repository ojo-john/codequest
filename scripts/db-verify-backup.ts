import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { backup, restore } from "./db-backup";

/**
 * Proves backup → wipe → restore round-trips on the LOCAL stack (spec §47: "tested recovery").
 * Seeds a marker learner, fingerprints every backed-up table (row count + content hash), backs up,
 * restores, and compares. Also proves a FAILED restore leaves the original data in place.
 *
 *   npm run db:verify-backup
 */

function localDbUrl(): string {
  const raw = execFileSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8", timeout: 30_000 });
  const url = (JSON.parse(raw.slice(raw.indexOf("{"))) as { DB_URL: string }).DB_URL;
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing to verify against non-local database ${host}`);
  return url;
}

async function fingerprint(sql: postgres.Sql): Promise<Record<string, string>> {
  const tables = await sql<{ name: string }[]>`
    select format('%I.%I', schemaname, tablename) as name from pg_tables
    where schemaname in ('public', 'private') or (schemaname = 'auth' and tablename in ('users', 'identities'))
    order by 1`;
  const result: Record<string, string> = {};
  for (const { name } of tables) {
    // Row count plus an order-independent hash of the full row contents.
    const [row] = await sql.unsafe(`select count(*)::text as n, coalesce(md5(string_agg(md5(t::text), '' order by md5(t::text))), '') as h from ${name} t`);
    result[name] = `${row.n}:${row.h}`;
  }
  return result;
}

function assertSame(before: Record<string, string>, after: Record<string, string>, label: string): void {
  const differences = Object.keys({ ...before, ...after }).filter((table) => before[table] !== after[table]);
  if (differences.length > 0) throw new Error(`${label} mismatch in: ${differences.join(", ")}`);
}

/** A learner with a note and XP, so the round-trip covers auth users, profiles and learner rows. */
async function seedMarkerLearner(sql: postgres.Sql, userId: string): Promise<void> {
  await sql`insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
            values (${userId}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${`backup-${userId}@codequest.test`}, now(), now())`;
  await sql`insert into public.content_items (id, kind) values ('test.backup-marker', 'lesson') on conflict do nothing`;
  await sql`insert into public.notes (user_id, content_id, body) values (${userId}, 'test.backup-marker', 'round-trip me: é ✓')`;
  await sql`insert into public.xp_ledger (user_id, event_key, delta) values (${userId}, 'backup-marker', 10)`;
}

async function main(): Promise<void> {
  const dbUrl = localDbUrl();
  const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });
  const dir = mkdtempSync(join(tmpdir(), "codequest-backup-"));
  const markerId = crypto.randomUUID();
  try {
    await seedMarkerLearner(sql, markerId);
    const before = await fingerprint(sql);
    const populated = Object.values(before).filter((value) => !value.startsWith("0:")).length;

    const file = backup(dbUrl, dir);
    restore(dbUrl, file);
    const after = await fingerprint(sql);
    assertSame(before, after, "round-trip");

    // A corrupt dump must fail the restore AND leave the data exactly as it was.
    const corrupt = join(dir, "corrupt.dump");
    writeFileSync(corrupt, readFileSync(file).subarray(0, 512));
    let failed = false;
    try {
      restore(dbUrl, corrupt);
    } catch {
      failed = true;
    }
    if (!failed) throw new Error("restoring a corrupt dump unexpectedly succeeded");
    assertSame(before, await fingerprint(sql), "failed restore");

    console.log(`Backup/restore verified: ${Object.keys(before).length} tables (${populated} with data) identical after restore; a corrupt dump was rejected with data intact.`);
  } finally {
    await sql`delete from auth.users where id = ${markerId}`;
    await sql.end({ timeout: 5 });
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
