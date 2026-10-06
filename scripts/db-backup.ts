import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

/**
 * Owner-run backup and restore (spec §64: Supabase Free has no automatic backups).
 *
 *   tsx scripts/db-backup.ts backup  [--db-url <url>] [--out-dir backups]
 *   tsx scripts/db-backup.ts restore [--db-url <url>] --file <dump> --wipe-existing-data
 *
 * Backs up DATA (learner records, content, auth users/identities) — the schema comes from
 * supabase/migrations, so restore into a database where those migrations are applied. The
 * connection string defaults to SUPABASE_DB_URL and is never printed. Tools run in the pinned
 * Supabase Postgres image so client and server versions match.
 */

export const PG_TOOLS_IMAGE = "public.ecr.aws/supabase/postgres:17.11.0.002";

/** Everything learner- or content-related; Supabase-internal schemas are left alone. Keep in sync with the wipe in restore(). */
export const BACKUP_TABLE_PATTERNS = ["public.*", "private.*", "auth.users", "auth.identities"] as const;

const TOOL_TIMEOUT_MS = 10 * 60_000;

/** Containers can't reach the host's loopback; rewrite it to Docker Desktop's host alias. */
function containerReachableUrl(dbUrl: string): string {
  const url = new URL(dbUrl);
  if (url.hostname === "127.0.0.1" || url.hostname === "localhost") url.hostname = "host.docker.internal";
  return url.toString();
}

function runTool(args: readonly string[], options: { mountDir: string }): void {
  const result = spawnSync(
    "docker",
    [
      "run", "--rm", "--platform", "linux/amd64",
      // Docker Desktop defines this alias itself; on Linux (CI) it must be mapped explicitly.
      "--add-host", "host.docker.internal:host-gateway",
      "--volume", `${options.mountDir}:/backup`,
      "--entrypoint", args[0], PG_TOOLS_IMAGE, ...args.slice(1),
    ],
    { stdio: ["ignore", "inherit", "inherit"], timeout: TOOL_TIMEOUT_MS },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${args[0]} exited ${result.status}`);
}

export function backup(dbUrl: string, outDir: string): string {
  const dir = resolve(outDir);
  mkdirSync(dir, { recursive: true });
  const fileName = `codequest-${new Date().toISOString().replace(/[:.]/g, "-")}.dump`;
  runTool(
    [
      "pg_dump", "--format=custom", "--data-only", "--no-owner", "--no-privileges",
      ...BACKUP_TABLE_PATTERNS.flatMap((pattern) => ["--table", pattern]),
      "--file", `/backup/${fileName}`, "--dbname", containerReachableUrl(dbUrl),
    ],
    { mountDir: dir },
  );
  return join(dir, fileName);
}

/**
 * Wipes and reloads in ONE transaction: the dump is first converted to SQL, then a single psql
 * session runs the truncate and the load under --single-transaction. Any failure rolls back
 * to the original data — never "wiped but not restored".
 */
export function restore(dbUrl: string, file: string): void {
  const dir = dirname(resolve(file));
  const sqlFile = `${basename(file)}.restore.sql`;
  runTool(["pg_restore", "--data-only", "--no-owner", "--no-privileges", "--file", `/backup/${sqlFile}`, `/backup/${basename(file)}`], { mountDir: dir });
  // Replica mode skips triggers (e.g. the new-user profile trigger) and FK ordering during the load.
  // Truncate exactly the backed-up set: every table in public/private plus the auth tables.
  const wipe = `do $$ begin execute (
      select 'truncate ' || string_agg(format('%I.%I', schemaname, tablename), ', ') || ', auth.users, auth.identities cascade'
      from pg_tables where schemaname in ('public', 'private')); end $$`;
  try {
    runTool(
      [
        "psql", "--no-psqlrc", "--single-transaction", "--set", "ON_ERROR_STOP=1", "--dbname", containerReachableUrl(dbUrl),
        "--command", "set session_replication_role = replica",
        "--command", wipe,
        "--file", `/backup/${sqlFile}`,
      ],
      { mountDir: dir },
    );
  } finally {
    rmSync(join(dir, sqlFile), { force: true });
  }
}

function main(): void {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      "db-url": { type: "string" },
      "out-dir": { type: "string", default: "backups" },
      file: { type: "string" },
      "wipe-existing-data": { type: "boolean", default: false },
    },
  });
  const dbUrl = values["db-url"] ?? process.env.SUPABASE_DB_URL;
  if (dbUrl === undefined) throw new Error("pass --db-url or set SUPABASE_DB_URL");

  if (positionals[0] === "backup") {
    console.log(`Backup written to ${backup(dbUrl, values["out-dir"])}`);
    return;
  }
  if (positionals[0] === "restore") {
    if (values.file === undefined) throw new Error("restore needs --file <dump>");
    if (!values["wipe-existing-data"]) {
      throw new Error("restore replaces ALL learner data in the target database; re-run with --wipe-existing-data to confirm");
    }
    restore(dbUrl, values.file);
    console.log(`Restored ${values.file}`);
    return;
  }
  throw new Error("usage: db-backup.ts <backup|restore> ...");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  try {
    main();
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
