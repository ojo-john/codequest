import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Copies Monaco's prebuilt assets into public/monaco (git-ignored) so the editor loads from our
 * own origin — no CDN at runtime, and it keeps working offline. Skips the copy when the installed
 * version is already in place. Runs before `dev` and `build`.
 */
const root = join(import.meta.dirname, "..");
const source = join(root, "node_modules", "monaco-editor", "min", "vs");
const target = join(root, "public", "monaco", "vs");
const marker = join(root, "public", "monaco", "VERSION");
const version = (JSON.parse(readFileSync(join(root, "node_modules", "monaco-editor", "package.json"), "utf8")) as { version: string }).version;

if (existsSync(marker) && readFileSync(marker, "utf8").trim() === version && existsSync(join(target, "loader.js"))) {
  process.exit(0);
}
rmSync(join(root, "public", "monaco"), { recursive: true, force: true });
cpSync(source, target, { recursive: true });
writeFileSync(marker, `${version}\n`);
console.log(`Copied monaco-editor ${version} assets to public/monaco.`);
