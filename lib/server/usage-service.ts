import "server-only";
import { staleBefore, usageReport, type ExecutionBudgetConfig, type UsageReport } from "@/lib/execution/budget";
import type { ExecutionUsageLedger } from "@/lib/execution/usage-ledger";
import type { Logger } from "@/lib/observability/log";

/**
 * The usage screen (spec §64): how much of the application's execution allowance is used, and how
 * big the database is against the free tier. Execution usage comes from the same ledger that
 * admits jobs, so the screen and admission can never disagree.
 */

export interface DatabaseSize {
  /** Total database size in bytes. */
  sizeBytes(): Promise<number>;
}

export interface UsageServiceDeps {
  readonly ledger: Pick<ExecutionUsageLedger, "usage">;
  readonly budget: ExecutionBudgetConfig;
  readonly database: DatabaseSize;
  readonly databaseQuotaBytes: number;
  readonly logger: Logger;
  readonly clock?: () => Date;
}

export interface UsageView {
  readonly execution: UsageReport;
  /** Undefined when the size couldn't be read; the rest of the screen still works. */
  readonly database?: { readonly usedBytes: number; readonly limitBytes: number };
}

export class UsageService {
  private readonly clock: () => Date;

  constructor(private readonly deps: UsageServiceDeps) {
    this.clock = deps.clock ?? (() => new Date());
  }

  async usage(userId: string): Promise<UsageView> {
    const now = this.clock();
    const [snapshot, database] = await Promise.all([this.deps.ledger.usage(userId, now, staleBefore(this.deps.budget, now)), this.databaseUsage()]);
    return { execution: usageReport(snapshot, this.deps.budget, now), ...(database && { database }) };
  }

  private async databaseUsage(): Promise<UsageView["database"]> {
    try {
      return { usedBytes: await this.deps.database.sizeBytes(), limitBytes: this.deps.databaseQuotaBytes };
    } catch (error) {
      // Informational only: show the execution usage without it rather than failing the page.
      this.deps.logger.log("warn", "usage.database_size_unavailable", { errorType: error instanceof Error ? error.name : "unknown" });
      this.deps.logger.metric("usage.database_size_unavailable", 1);
      return undefined;
    }
  }
}
