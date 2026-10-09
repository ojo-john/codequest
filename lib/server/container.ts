import "server-only";
import { z } from "zod";
import { loadArchiveSigningKey } from "@/lib/archive/archive-signing";
import { createServiceRoleClient, loadSupabaseServerConfig } from "@/lib/db/supabase-server";
import { loadExecutionBudgetConfig } from "@/lib/execution/budget";
import { DockerSandboxProvider } from "@/lib/execution/docker-sandbox-provider";
import { SandboxJavaExecutor } from "@/lib/execution/java-executor";
import { loadExecutionLimits } from "@/lib/execution/limits";
import { MeteredJavaExecutor } from "@/lib/execution/metered-executor";
import type { SandboxProvider } from "@/lib/execution/sandbox-provider";
import { SupabaseDatabaseSize, SupabaseExecutionUsageLedger } from "@/lib/execution/supabase-usage-ledger";
import { loadVercelSandboxConfig, VercelSandboxProvider } from "@/lib/execution/vercel-sandbox-provider";
import { createLogger } from "@/lib/observability/log";
import { ArchiveService } from "./archive-service";
import { ExerciseService } from "./exercise-service";
import { SupabaseExerciseStore } from "./exercise-store";
import { JournalService } from "./journal-service";
import { SupabaseJournalStore } from "./journal-store";
import { SupabaseArchiveStore } from "./archive-store";
import { LearningService } from "./learning-service";
import { UsageService } from "./usage-service";
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

let archive: ArchiveService | undefined;

export function archiveService(): ArchiveService {
  if (archive) return archive;
  const env = process.env;
  archive = new ArchiveService({
    store: new SupabaseArchiveStore(createServiceRoleClient(loadSupabaseServerConfig(env))),
    signingKey: loadArchiveSigningKey(env),
    limits: loadExecutionLimits(env),
    logger: createLogger({ component: "archive" }),
  });
  return archive;
}

let journal: JournalService | undefined;

export function journalService(): JournalService {
  if (journal) return journal;
  const db = createServiceRoleClient(loadSupabaseServerConfig(process.env));
  journal = new JournalService({ store: new SupabaseJournalStore(db), quests: new SupabaseLearningStore(db) });
  return journal;
}

/** Supabase Free includes a 500 MB database (spec §64); override when the plan changes. */
const databaseQuotaSchema = z.coerce.number().int().positive().default(500 * 1024 * 1024);

let usage: UsageService | undefined;

export function usageService(): UsageService {
  if (usage) return usage;
  const env = process.env;
  const db = createServiceRoleClient(loadSupabaseServerConfig(env));
  usage = new UsageService({
    ledger: new SupabaseExecutionUsageLedger(db),
    budget: loadExecutionBudgetConfig(env),
    database: new SupabaseDatabaseSize(db),
    databaseQuotaBytes: databaseQuotaSchema.parse(env.SUPABASE_DATABASE_QUOTA_BYTES),
    logger: createLogger({ component: "usage" }),
  });
  return usage;
}

let exercises: ExerciseService | undefined;

export function exerciseService(): ExerciseService {
  if (exercises) return exercises;
  const db = createServiceRoleClient(loadSupabaseServerConfig(process.env));
  exercises = new ExerciseService({ store: new SupabaseExerciseStore(db), skills: new SupabaseLearningStore(db) });
  return exercises;
}
