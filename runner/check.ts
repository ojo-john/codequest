import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import { Sandbox } from "@vercel/sandbox";
import { DockerSandboxProvider } from "../lib/execution/docker-sandbox-provider";
import { SandboxJavaExecutor, type ExecutionResult } from "../lib/execution/java-executor";
import { loadExecutionLimits, type ExecutionLimits } from "../lib/execution/limits";
import type { ExecutionOutcome } from "../lib/execution/outcome";
import type { SandboxProvider } from "../lib/execution/sandbox-provider";
import { validateSourceFiles, type SourceFile } from "../lib/execution/source-files";
import { loadVercelSandboxConfig, VercelSandboxProvider, type VercelSandboxConfig } from "../lib/execution/vercel-sandbox-provider";
import { createLogger } from "../lib/observability/log";
import { loadToolchain, RUNNER_DIR } from "./toolchain";

/**
 * Phase 0 proof gate (spec §65): runs the proof suite (multi-file compile + JUnit) and the
 * adversarial smoke suite against a provider, prints a verdict table, and writes the evidence to
 * docs/evidence/. Exits non-zero if any required case misbehaves.
 *
 *   tsx runner/check.ts --provider docker|vercel --suite proof|smoke|all
 */

type CaseKind = "required" | "informational";

interface CheckCase {
  readonly name: string;
  readonly suite: "proof" | "smoke";
  readonly fixtures: readonly string[];
  readonly kind: CaseKind;
  /** Acceptable outcomes; more than one where containment is the point, not the exact symptom. */
  readonly expectOutcome: ExecutionOutcome | readonly ExecutionOutcome[];
  readonly expectDetail?: string;
  /** Extra assertion; returns a failure reason or undefined. */
  readonly verify?: (result: ExecutionResult, limits: ExecutionLimits) => string | undefined;
  readonly note?: string;
}

const CASES: readonly CheckCase[] = [
  { name: "multi-file-pass", suite: "proof", fixtures: ["shop-correct", "shop-tests"], kind: "required", expectOutcome: "succeeded",
    verify: (r) => (r.summary?.tests === 4 ? undefined : `expected 4 tests, got ${r.summary?.tests}`) },
  { name: "off-by-one", suite: "proof", fixtures: ["shop-off-by-one", "shop-tests"], kind: "required", expectOutcome: "wrong-answer",
    verify: (r) => (r.summary?.failures === 2 ? undefined : `expected 2 failures, got ${r.summary?.failures}`) },
  { name: "compile-error", suite: "proof", fixtures: ["shop-compile-error", "shop-tests"], kind: "required", expectOutcome: "compile-error",
    verify: (r) => (r.compileOutput?.includes("';' expected") ? undefined : "javac diagnostic missing from output") },

  { name: "infinite-loop", suite: "smoke", fixtures: ["smoke/infinite-loop"], kind: "required", expectOutcome: "timeout" },
  { name: "memory-pressure", suite: "smoke", fixtures: ["smoke/memory-pressure"], kind: "required", expectOutcome: "runtime-error", expectDetail: "memory_limit" },
  { name: "output-flood", suite: "smoke", fixtures: ["smoke/output-flood"], kind: "required", expectOutcome: "timeout", expectDetail: "output_limit",
    verify: (r, limits) => (Buffer.byteLength(r.testOutput ?? "") <= limits.maxOutputBytes ? undefined : "output exceeded limit") },
  // Once the per-user cap is hit the JVM itself cannot create threads, so the learner-visible
  // symptom varies; what must hold is a learner outcome (not infra) and a cap below 1000.
  { name: "process-limit", suite: "smoke", fixtures: ["smoke/process-limit"], kind: "required",
    expectOutcome: ["succeeded", "runtime-error", "timeout"],
    verify: (r) => (/spawned=1000\b/.test(r.testOutput ?? "") ? "spawned all 1000 processes" : undefined) },
  { name: "network-http", suite: "smoke", fixtures: ["smoke/network-http"], kind: "required", expectOutcome: "succeeded" },
  { name: "dns-lookup", suite: "smoke", fixtures: ["smoke/dns-lookup"], kind: "informational", expectOutcome: "succeeded",
    note: "records dns=resolved|blocked; outbound connections are covered by network-http" },
  { name: "privilege", suite: "smoke", fixtures: ["smoke/privilege"], kind: "required", expectOutcome: "succeeded" },
  { name: "forged-stdout", suite: "smoke", fixtures: ["smoke/forged-stdout"], kind: "required", expectOutcome: "wrong-answer" },
  { name: "system-exit", suite: "smoke", fixtures: ["smoke/system-exit"], kind: "required", expectOutcome: "runtime-error", expectDetail: "no_test_report" },
  { name: "report-forgery", suite: "smoke", fixtures: ["smoke/report-forgery"], kind: "informational", expectOutcome: "wrong-answer",
    note: "known limitation (spec §65): in-JVM code can rewrite the report; documented in docs/SECURITY.md" },
  { name: "background-process", suite: "smoke", fixtures: ["smoke/background-process"], kind: "required", expectOutcome: "succeeded",
    note: "followed by a check that no execution environments are left running" },
];

function loadFixtureSources(fixtures: readonly string[]): SourceFile[] {
  const files: SourceFile[] = [];
  for (const fixture of fixtures) {
    const root = join(RUNNER_DIR, "fixtures", fixture);
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const absolute = join(entry.parentPath, entry.name);
      files.push({ path: relative(root, absolute).split("\\").join("/"), content: readFileSync(absolute, "utf8") });
    }
  }
  return files;
}

function verdict(check: CheckCase, result: ExecutionResult, limits: ExecutionLimits): string | undefined {
  const accepted: readonly ExecutionOutcome[] = typeof check.expectOutcome === "string" ? [check.expectOutcome] : check.expectOutcome;
  if (!accepted.includes(result.outcome)) return `expected ${accepted.join("|")}, got ${result.outcome}/${result.detail}`;
  if (check.expectDetail !== undefined && result.detail !== check.expectDetail) {
    return `expected detail ${check.expectDetail}, got ${result.detail}`;
  }
  return check.verify?.(result, limits);
}

async function countLiveEnvironments(provider: "docker" | "vercel", vercel?: VercelSandboxConfig): Promise<number> {
  if (provider === "docker") {
    const ids = execFileSync("docker", ["ps", "--quiet", "--filter", "label=app=codequest"], { encoding: "utf8" });
    return ids.split("\n").filter((id) => id.trim() !== "").length;
  }
  const listing = await Sandbox.list({ ...(vercel?.credentials ?? {}), tags: { app: "codequest" } });
  let live = 0;
  for await (const sandbox of listing) {
    if (sandbox.status === "running" || sandbox.status === "pending") live += 1;
  }
  return live;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { provider: { type: "string", default: "docker" }, suite: { type: "string", default: "all" } },
  });
  const providerName = values.provider;
  if (providerName !== "docker" && providerName !== "vercel") throw new Error("--provider must be docker or vercel");
  const suite = values.suite;
  if (suite !== "proof" && suite !== "smoke" && suite !== "all") throw new Error("--suite must be proof, smoke or all");

  const limits = loadExecutionLimits(process.env);
  const vercelConfig = providerName === "vercel" ? loadVercelSandboxConfig(process.env) : undefined;
  const provider: SandboxProvider = vercelConfig ? new VercelSandboxProvider(vercelConfig) : new DockerSandboxProvider();
  const logger = createLogger({ provider: providerName }, () => {}); // keep the table readable
  const executor = new SandboxJavaExecutor({ provider, limits, logger });

  const selected = CASES.filter((check) => suite === "all" || check.suite === suite);
  const rows: Array<Record<string, unknown>> = [];
  let requiredFailures = 0;

  for (const check of selected) {
    const validation = validateSourceFiles(loadFixtureSources(check.fixtures), limits);
    if (!validation.ok) throw new Error(`fixture ${check.name} is invalid: ${JSON.stringify(validation.issues)}`);

    const result = await executor.execute(validation.files, { requestId: randomUUID() });
    const failure = verdict(check, result, limits);
    if (failure !== undefined && check.kind === "required") requiredFailures += 1;
    const status = failure === undefined ? "PASS" : check.kind === "required" ? "FAIL" : "NOTE";
    console.log(
      `${status.padEnd(4)}  ${check.name.padEnd(19)} ${`${result.outcome}/${result.detail}`.padEnd(40)} ${String(result.timingsMs.total).padStart(6)} ms${failure ? `  — ${failure}` : ""}`,
    );
    rows.push({
      name: check.name,
      suite: check.suite,
      kind: check.kind,
      status,
      failure,
      note: check.note,
      outcome: result.outcome,
      detail: result.detail,
      stage: result.stage,
      summary: result.summary,
      timingsMs: result.timingsMs,
      infrastructureErrorType: result.infrastructureErrorType,
      // Evidence only needs a short excerpt; full output is bounded by the harness anyway.
      outputExcerpt: (result.testOutput ?? result.compileOutput ?? "").slice(0, 2000),
    });
  }

  const live = await countLiveEnvironments(providerName, vercelConfig);
  const leftoverFailure = live > 0 ? `${live} execution environment(s) still running after cleanup` : undefined;
  if (leftoverFailure) requiredFailures += 1;
  console.log(`${leftoverFailure ? "FAIL" : "PASS"}  ${"cleanup".padEnd(19)} live environments after run: ${live}`);

  const evidenceDir = join(RUNNER_DIR, "..", "docs", "evidence");
  mkdirSync(evidenceDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const evidencePath = join(evidenceDir, `${providerName}-${suite}-${stamp}.json`);
  writeFileSync(
    evidencePath,
    `${JSON.stringify({ recordedAt: new Date().toISOString(), provider: providerName, suite, toolchain: loadToolchain(), limits, liveEnvironmentsAfterRun: live, results: rows }, null, 2)}\n`,
  );
  console.log(`\nEvidence: ${relative(process.cwd(), evidencePath)}`);
  console.log(requiredFailures === 0 ? "Proof gate: PASSED" : `Proof gate: FAILED (${requiredFailures} required check(s))`);
  process.exitCode = requiredFailures === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
