import type { ExecutionLimits } from "./limits";

/**
 * Boundary validation for learner-submitted Java source sets (spec §65: validate source paths,
 * reject traversal; constrain uploads).
 *
 * Sources arrive as (path, text) pairs — never archives or symlinks — so archive bombs and
 * symlink tricks are excluded by construction. Paths are restricted to a conservative character
 * set so they are also safe inside the harness's javac argfile.
 */

export interface SourceFile {
  readonly path: string;
  readonly content: string;
}

declare const validatedBrand: unique symbol;

/** A source set that has passed {@link validateSourceFiles}; only these reach the executor. */
export type ValidatedSourceSet = readonly SourceFile[] & { readonly [validatedBrand]: true };

export type SourceValidationIssue =
  | { readonly code: "empty_source_set" }
  | { readonly code: "too_many_files"; readonly count: number; readonly max: number }
  | { readonly code: "total_size_exceeded"; readonly bytes: number; readonly max: number }
  | { readonly code: "invalid_path"; readonly path: string; readonly reason: string }
  | { readonly code: "duplicate_path"; readonly path: string }
  | { readonly code: "invalid_content"; readonly path: string; readonly reason: string };

export type SourceValidationResult =
  | { readonly ok: true; readonly files: ValidatedSourceSet }
  | { readonly ok: false; readonly issues: readonly SourceValidationIssue[] };

const MAX_PATH_LENGTH = 200;
const MAX_PATH_DEPTH = 12;
/** Java identifier-ish segments; dots allowed only for the `.java` suffix (checked separately). */
const SEGMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const FILE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*\.java$/;

function pathProblem(path: string): string | undefined {
  if (path.length === 0) return "empty";
  if (path.length > MAX_PATH_LENGTH) return `longer than ${MAX_PATH_LENGTH} characters`;
  if (path.startsWith("/")) return "absolute paths are not allowed";
  if (path.includes("\\")) return "backslashes are not allowed";
  if (path.includes("\0")) return "NUL bytes are not allowed";

  const segments = path.split("/");
  if (segments.length > MAX_PATH_DEPTH) return `deeper than ${MAX_PATH_DEPTH} levels`;

  const fileName = segments[segments.length - 1];
  if (!FILE_PATTERN.test(fileName)) return "file name must be a Java identifier ending in .java";
  for (const segment of segments.slice(0, -1)) {
    if (segment === "") return "empty path segment";
    if (segment === "." || segment === "..") return "relative segments are not allowed";
    if (!SEGMENT_PATTERN.test(segment)) return `invalid directory name '${segment}'`;
  }
  return undefined;
}

export function validateSourceFiles(
  files: readonly SourceFile[],
  limits: Pick<ExecutionLimits, "maxSourceFiles" | "maxTotalSourceBytes">,
): SourceValidationResult {
  const issues: SourceValidationIssue[] = [];

  if (files.length === 0) {
    return { ok: false, issues: [{ code: "empty_source_set" }] };
  }
  if (files.length > limits.maxSourceFiles) {
    issues.push({ code: "too_many_files", count: files.length, max: limits.maxSourceFiles });
  }

  let totalBytes = 0;
  // Case-insensitive so two paths can't collide on a case-insensitive checkout/export.
  const seen = new Set<string>();
  for (const file of files) {
    const problem = pathProblem(file.path);
    if (problem !== undefined) {
      issues.push({ code: "invalid_path", path: file.path, reason: problem });
    }
    const key = file.path.toLowerCase();
    if (seen.has(key)) {
      issues.push({ code: "duplicate_path", path: file.path });
    }
    seen.add(key);

    if (file.content.includes("\0")) {
      issues.push({ code: "invalid_content", path: file.path, reason: "NUL bytes are not allowed" });
    }
    totalBytes += Buffer.byteLength(file.content, "utf8");
  }

  if (totalBytes > limits.maxTotalSourceBytes) {
    issues.push({ code: "total_size_exceeded", bytes: totalBytes, max: limits.maxTotalSourceBytes });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  const copy = Object.freeze(files.map((file) => Object.freeze({ path: file.path, content: file.content })));
  return { ok: true, files: copy as unknown as ValidatedSourceSet };
}
