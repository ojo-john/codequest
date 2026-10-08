import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { loadContent, type LoadedQuest } from "../lib/content/repository";
import { validateContent, type ContentIssue } from "../lib/content/validate";
import { DockerSandboxProvider } from "../lib/execution/docker-sandbox-provider";
import { SandboxJavaExecutor, type ExecutionResult } from "../lib/execution/java-executor";
import { loadExecutionLimits } from "../lib/execution/limits";
import { validateSourceFiles } from "../lib/execution/source-files";
import { loadVercelSandboxConfig, VercelSandboxProvider } from "../lib/execution/vercel-sandbox-provider";
import { createLogger } from "../lib/observability/log";

/**
 * Content gate (spec §44, §71). Fails if any of these is false:
 *   - every file parses and every reference (skills, campaign slots, hints order) is valid
 *   - nothing private (expected values, reference code) appears in public files
 *   - every reference solution PASSES its contract under the pinned JDK
 *   - every starter compiles (unless declared otherwise) and does NOT already pass
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
    }
  }

  const unreviewed = content.quests.filter((quest) => quest.manifest.review.status === "draft" || quest.manifest.review.status === "ai_reviewed");
  console.log(`\n${content.quests.length} quest(s), ${content.skills?.skills.length ?? 0} skill(s); ${unreviewed.length} awaiting human review.`);
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
