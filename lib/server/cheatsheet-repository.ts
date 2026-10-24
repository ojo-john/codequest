import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cheatsheetIndexSchema, type Cheatsheet } from "@/lib/cheatsheets/cheatsheets";

/**
 * Reads cheat sheets from content/cheatsheets. The files ship with the server functions through
 * outputFileTracingIncludes in next.config.ts. Loaded once per process: they change only with a
 * deploy.
 */

export const CHEATSHEET_DIR = join(process.cwd(), "content", "cheatsheets");

let cached: readonly Cheatsheet[] | undefined;

export function loadCheatsheets(directory = CHEATSHEET_DIR): readonly Cheatsheet[] {
  if (directory === CHEATSHEET_DIR && cached) return cached;
  const index = cheatsheetIndexSchema.parse(JSON.parse(readFileSync(join(directory, "index.json"), "utf8")));
  const sheets = index.sheets.map((meta) => ({ ...meta, body: readFileSync(join(directory, meta.file), "utf8") }));
  if (directory === CHEATSHEET_DIR) cached = sheets;
  return sheets;
}
