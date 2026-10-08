import "server-only";
import { z } from "zod";
import { createServiceRoleClient, loadSupabaseServerConfig } from "@/lib/db/supabase-server";
import { loadExecutionBudgetConfig } from "@/lib/execution/budget";
import { DockerSandboxProvider } from "@/lib/execution/docker-sandbox-provider";
import { SandboxJavaExecutor } from "@/lib/execution/java-executor";
import { loadExecutionLimits } from "@/lib/execution/limits";
import { MeteredJavaExecutor } from "@/lib/execution/metered-executor";
import type { SandboxProvider } from "@/lib/execution/sandbox-provider";
import { SupabaseExecutionUsageLedger } from "@/lib/execution/supabase-usage-ledger";
import { loadVercelSandboxConfig, VercelSandboxProvider } from "@/lib/execution/vercel-sandbox-provider";
import { createLogger } from "@/lib/observability/log";
import { LearningService } from "./learning-service";
import { SupabaseLearningStore } from "./learning-store";

/**
 * Composition root: builds the server's object graph once per process from validated config.
 * Execution defaults to Vercel Sandbox on Vercel and to the local Docker runner elsewhere; set
 * EXECUTION_PROVIDER to override. (Local Docker results are practice evidence, spec §65.)
 */

const providerSchema = z.enum(["vercel", "docker"]);

function buildProvider(env: NodeJS.ProcessEnv): SandboxProvider {
  const name = providerSchema.parse(env.EXECUTION_PROVIDER ?? (env.VERCEL ? "vercel" : "docker"));
  return name === "vercel" ? new VercelSandboxProvider(loadVercelSandboxConfig(env)) : new DockerSandboxProvider();
}

let service: LearningService | undefined;

export function learningService(): LearningService {
  if (service) return service;
  const env = process.env;
  const limits = loadExecutionLimits(env);
  const db = createServiceRoleClient(loadSupabaseServerConfig(env));
  const logger = createLogger({ component: "execution" });
  const executor = new MeteredJavaExecutor({
    inner: new SandboxJavaExecutor({ provider: buildProvider(env), limits, logger }),
    ledger: new SupabaseExecutionUsageLedger(db),
    budget: loadExecutionBudgetConfig(env),
    limits,
    logger,
  });
  service = new LearningService({ store: new SupabaseLearningStore(db), executor, limits });
  return service;
}
