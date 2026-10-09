import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { loadContent, type LoadedExerciseSet, type LoadedQuest } from "../lib/content/repository";
import { validateContent, type ContentIssue } from "../lib/content/validate";
import { DockerSandboxProvider } from "../lib/execution/docker-sandbox-provider";
import { SandboxJavaExecutor, type ExecutionResult } from "../lib/execution/java-executor";
import { loadExecutionLimits } from "../lib/execution/limits";
import { validateSourceFiles } from "../lib/execution/source-files";
import { outputVerificationSources } from "../lib/exercises/verify-output";
import { loadVercelSandboxConfig, VercelSandboxProvider } from "../lib/execution/vercel-sandbox-provider";
import { createLogger } from "../lib/observability/log";

/**
 * Content gate (spec §44, §71). Fails if any of these is false:
 *   - every file parses and every reference (skills, campaign slots, hints order) is valid
 *   - nothing private (expected values, reference code) appears in public files
 *   - every reference solution PASSES its contract under the pinned JDK
 *   - every starter compiles (unless declared otherwise) and does NOT already pass
 *   - with testQuality: the reference tests pass on the reference and catch EVERY mutant
 *   - every predict-output exercise prints exactly its canonical answer
 *
 *   npm run content:check [-- --provider vercel] [-- --static-only]
 */

const CONTENT_ROOT = join(import.meta.dirname, "..", "content");

async function runQuest(executor: SandboxJavaExecutor, quest: LoadedQuest, which: "reference" | "starter"): Promise<ExecutionResult> {
  const files = which === "reference" ? quest.reference : quest.starter;
  const validated = validateSourceFiles(files, loadExecutionLimits(process.env));
  if (!validated.ok) throw new Error(`${quest.manifest.id} ${which} files are invalid`);
  return executor.execute(validated.files, {
    requestId: randomUUID(),
    grading: { kind: "contract", contract: quest.privateData.contract },
  });
}

/**
 * The mutant check runs with a long sandbox lifetime so its verdict never depends on host speed
 * (the local runner image is amd64 and runs emulated on Apple silicon, ~10x slower). On Vercel
 * the same run must also fit the production lifetime, or learners would get "incomplete".
 */
const GATE_LIFETIME_SECONDS = 300;

/** Runs the reference tests as if a learner wrote them: they must be valid and catch every mutant. */
async function checkTestQuality(executor: SandboxJavaExecutor, quest: LoadedQuest, productionBudgetMs: number | undefined): Promise<string | undefined> {
  const quality = quest.testQuality;
  if (quality === undefined) return undefined;
  const validated = validateSourceFiles([...quest.reference, ...quality.referenceTests], loadExecutionLimits(process.env));
  if (!validated.ok) return "reference + reference tests are invalid";
  const baseline = quest.reference.find((file) => file.path === quality.target)?.content ?? "";
  const started = performance.now();
  const result = await executor.execute(validated.files, {
    requestId: randomUUID(),
    grading: { kind: "contract", contract: quest.privateData.contract },
    testQuality: { target: quality.target, baseline, mutants: quality.mutants, passRatio: quality.passRatio },
  });
  const report = result.testQuality;
  if (report?.status !== "graded") return `reference tests must be valid on the reference, got ${report?.status ?? "no report"} (${report?.failingOnReference?.join(", ") ?? "-"})`;
  if (report.total !== quality.mutants.length) return `every mutant must compile with the reference tests; ${quality.mutants.length - report.total} did not`;
  if (report.missed.length > 0) return `reference tests miss mutant(s): ${report.missed.map((mutant) => mutant.id).join(", ")}`;
  const elapsedMs = Math.round(performance.now() - started);
  console.log(`  ${quest.manifest.id}: reference tests catch ${report.caught.length}/${quality.mutants.length} mutants (${elapsedMs} ms)`);
  if (productionBudgetMs !== undefined && elapsedMs > productionBudgetMs) {
    return `test-quality grading took ${elapsedMs} ms, over the production sandbox budget of ${productionBudgetMs} ms; use fewer mutants`;
  }
  return undefined;
}

/** Runs every predict-output program of a set and compares its output with the canonical answer. */
async function checkPredictOutputs(executor: SandboxJavaExecutor, set: LoadedExerciseSet): Promise<string | undefined> {
  const { files, checks } = outputVerificationSources(set.manifest.questions, set.privateData.answers);
  if (checks.length === 0) return undefined;
  const validated = validateSourceFiles(files, loadExecutionLimits(process.env));
  if (!validated.ok) return `predict-output programs are invalid: ${JSON.stringify(validated.issues)}`;
  const result = await executor.execute(validated.files, { requestId: randomUUID(), grading: { kind: "junit" } });
  console.log(`  ${set.manifest.id}: ${checks.length} predict-output program(s) ${result.outcome}`);
  if (result.outcome === "succeeded") return undefined;
  const failed = checks.filter((check) => result.summary?.failedTests.some((name) => name.startsWith(check.testName))).map((check) => check.questionId);
  const detail = failed.length > 0 ? `wrong canonical output for ${failed.join(", ")}` : `${result.outcome}/${result.detail}`;
  return `${detail}\n${(result.compileOutput || result.testOutput || "").slice(-1500)}`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { provider: { type: "string", default: "docker" }, "static-only": { type: "boolean", default: false } },
  });
  const limits = loadExecutionLimits(process.env);
  const content = loadContent(CONTENT_ROOT);
  const issues: ContentIssue[] = validateContent(content, limits);

  if (!values["static-only"] && issues.length === 0) {
    const provider = values.provider === "vercel" ? new VercelSandboxProvider(loadVercelSandboxConfig(process.env)) : new DockerSandboxProvider();
    const executor = new SandboxJavaExecutor({ provider, limits, logger: createLogger({ component: "content-check" }, () => {}) });
    const gateExecutor = new SandboxJavaExecutor({
      provider,
      limits: { ...limits, sandboxLifetimeSeconds: Math.max(limits.sandboxLifetimeSeconds, GATE_LIFETIME_SECONDS) },
      logger: createLogger({ component: "content-check" }, () => {}),
    });
    // Leave the same margin the executor keeps for cleanup.
    const productionBudgetMs = values.provider === "vercel" ? (limits.sandboxLifetimeSeconds - 5) * 1000 : undefined;

    for (const quest of content.quests) {
      const item = quest.manifest.id;
      const reference = await runQuest(executor, quest, "reference");
      if (reference.outcome !== "succeeded") {
        issues.push({
          item,
          message: `reference solution must pass its contract, got ${reference.outcome}/${reference.detail} (failed: ${reference.summary?.failedTests.join(", ") ?? "-"})`,
        });
      }
      const starter = await runQuest(executor, quest, "starter");
      if (starter.outcome === "succeeded") issues.push({ item, message: "starter already passes the contract — the task is trivial" });
      if (quest.manifest.starterCompiles && starter.outcome === "compile-error") issues.push({ item, message: "starter is declared to compile but does not" });
      if (starter.outcome === "infrastructure-error" || reference.outcome === "infrastructure-error") {
        issues.push({ item, message: "execution infrastructure failed; rerun before trusting this result" });
      }
      console.log(`  ${item}: reference ${reference.outcome}, starter ${starter.outcome}/${starter.detail}`);
      const quality = await checkTestQuality(gateExecutor, quest, productionBudgetMs);
      if (quality !== undefined) issues.push({ item, message: quality });
    }
    for (const set of content.exerciseSets) {
      const problem = await checkPredictOutputs(executor, set);
      if (problem !== undefined) issues.push({ item: set.manifest.id, message: problem });
    }
  }

  const items = [...content.quests, ...content.exerciseSets];
  const unreviewed = items.filter((item) => item.manifest.review.status === "draft" || item.manifest.review.status === "ai_reviewed");
  console.log(`\n${content.quests.length} quest(s), ${content.exerciseSets.length} exercise set(s), ${content.skills?.skills.length ?? 0} skill(s); ${unreviewed.length} awaiting human review.`);
  if (issues.length > 0) {
    for (const issue of issues) console.error(`✗ ${issue.item}: ${issue.message}`);
    console.error(`\nContent gate: FAILED (${issues.length} issue(s))`);
    process.exitCode = 1;
    return;
  }
  console.log("Content gate: PASSED");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
