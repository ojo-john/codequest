import { z } from "zod";

/**
 * Execution limits (spec §65 initial values). Every value is overridable through an
 * `EXECUTION_*` environment variable so tuning after measurement is a config change, not a code
 * change. Parsed once at the boundary with Zod; invalid config fails fast at startup.
 */
const executionLimitsSchema = z.object({
  maxSourceFiles: z.coerce.number().int().positive().default(20),
  maxTotalSourceBytes: z.coerce.number().int().positive().default(200 * 1024),
  compileWallSeconds: z.coerce.number().int().positive().default(30),
  testWallSeconds: z.coerce.number().int().positive().default(10),
  heapMb: z.coerce.number().int().positive().default(256),
  maxOutputBytes: z.coerce.number().int().positive().default(64 * 1024),
  maxReportBytes: z.coerce.number().int().positive().default(1024 * 1024),
  sandboxLifetimeSeconds: z.coerce.number().int().positive().default(60),
  /** Grace added to the outer per-command SIGKILL beyond the harness's own inner deadline. */
  commandGraceSeconds: z.coerce.number().int().nonnegative().default(5),
  /** Cap on the best-effort stop() call made during cleanup. */
  cleanupTimeoutSeconds: z.coerce.number().int().positive().default(15),
  vcpus: z.coerce.number().int().min(1).max(4).default(1),
});

export type ExecutionLimits = Readonly<z.infer<typeof executionLimitsSchema>>;

const ENV_KEYS: Record<keyof ExecutionLimits, string> = {
  maxSourceFiles: "EXECUTION_MAX_SOURCE_FILES",
  maxTotalSourceBytes: "EXECUTION_MAX_TOTAL_SOURCE_BYTES",
  compileWallSeconds: "EXECUTION_COMPILE_WALL_SECONDS",
  testWallSeconds: "EXECUTION_TEST_WALL_SECONDS",
  heapMb: "EXECUTION_HEAP_MB",
  maxOutputBytes: "EXECUTION_MAX_OUTPUT_BYTES",
  maxReportBytes: "EXECUTION_MAX_REPORT_BYTES",
  sandboxLifetimeSeconds: "EXECUTION_SANDBOX_LIFETIME_SECONDS",
  commandGraceSeconds: "EXECUTION_COMMAND_GRACE_SECONDS",
  cleanupTimeoutSeconds: "EXECUTION_CLEANUP_TIMEOUT_SECONDS",
  vcpus: "EXECUTION_VCPUS",
};

export function loadExecutionLimits(env: Readonly<Record<string, string | undefined>> = process.env): ExecutionLimits {
  const raw = Object.fromEntries(
    Object.entries(ENV_KEYS)
      .map(([key, envKey]) => [key, env[envKey]] as const)
      .filter(([, value]) => value !== undefined && value !== ""),
  );
  return Object.freeze(executionLimitsSchema.parse(raw));
}

export const DEFAULT_EXECUTION_LIMITS: ExecutionLimits = loadExecutionLimits({});
