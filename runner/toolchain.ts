import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** Loads and validates runner/toolchain.json — the single source of truth for pinned versions. */

const sha256 = z.string().regex(/^[0-9a-f]{64}$/, "expected a lowercase hex SHA-256");
const artifact = z.object({ url: z.url().startsWith("https://"), sha256, license: z.string().min(1) });

const toolchainSchema = z.object({
  baseImage: z.string().min(1),
  jdk: artifact.extend({ distribution: z.string(), release: z.string() }),
  junit: artifact.extend({ artifact: z.string(), version: z.string(), jupiterVersion: z.string() }),
});

export type Toolchain = Readonly<z.infer<typeof toolchainSchema>>;

export const RUNNER_DIR = fileURLToPath(new URL("./", import.meta.url));

export function loadToolchain(): Toolchain {
  const raw: unknown = JSON.parse(readFileSync(new URL("./toolchain.json", import.meta.url), "utf8"));
  return toolchainSchema.parse(raw);
}
