import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseExecutionUsageLedger } from "@/lib/execution/supabase-usage-ledger";
import { usageLedgerContract } from "../shared/usage-ledger-contract";
import { closeSql, createTestUser, deleteTestUser, serviceClient, sql, type TestUser } from "./support/local-supabase";

let users: [TestUser, TestUser];

beforeAll(async () => {
  users = [await createTestUser("ledger-a"), await createTestUser("ledger-b")];
});

afterAll(async () => {
  await Promise.all(users.map(deleteTestUser));
  await closeSql();
});

async function resetLedger(): Promise<void> {
  await sql()`truncate public.execution_jobs`;
  await sql()`update private.execution_controls set paused_until = null, usage_version = 0`;
}

usageLedgerContract("SupabaseExecutionUsageLedger", async () => {
  await resetLedger();
  return {
    ledger: new SupabaseExecutionUsageLedger(serviceClient(), { maxReserveAttempts: 20 }),
    userIds: [users[0].id, users[1].id],
  };
});

describe("SupabaseExecutionUsageLedger failure paths", () => {
  it("admit_databaseUnreachable_failsClosedWithRetryableError", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const unreachable = createClient("http://127.0.0.1:9", "sb_secret_unreachable_key_for_tests", {
      auth: { persistSession: false },
    });
    const ledger = new SupabaseExecutionUsageLedger(unreachable);

    const attempt = ledger.admit(
      { jobId: crypto.randomUUID(), userId: users[0].id, now: new Date(), reserveCpuSeconds: 60 },
      () => ({ admitted: true }),
    );

    await expect(attempt).rejects.toMatchObject({ name: "LedgerError", errorType: "ledger_unreachable", retryable: true });
  });

  it("admit_versionKeepsChanging_givesUpWithContentionError", async () => {
    await resetLedger();
    const client = serviceClient();
    const realRpc = client.rpc.bind(client);
    // Another writer always gets in between our snapshot and our reservation.
    const contended = new Proxy(client, {
      get(target, property, receiver) {
        if (property !== "rpc") return Reflect.get(target, property, receiver);
        return async (fn: string, args: Record<string, unknown>) => {
          if (fn === "reserve_execution_job") await sql()`update private.execution_controls set usage_version = usage_version + 1`;
          return realRpc(fn, args);
        };
      },
    });
    const ledger = new SupabaseExecutionUsageLedger(contended, { maxReserveAttempts: 3, sleep: async () => {} });

    const attempt = ledger.admit(
      { jobId: crypto.randomUUID(), userId: users[0].id, now: new Date(), reserveCpuSeconds: 60 },
      () => ({ admitted: true }),
    );

    await expect(attempt).rejects.toMatchObject({ name: "LedgerError", errorType: "ledger_contention", retryable: true });
  });

  it("admit_controlsRowMissing_failsClosedWithClearError", async () => {
    await sql()`delete from private.execution_controls`;
    try {
      const ledger = new SupabaseExecutionUsageLedger(serviceClient());

      const attempt = ledger.admit(
        { jobId: crypto.randomUUID(), userId: users[0].id, now: new Date(), reserveCpuSeconds: 60 },
        () => ({ admitted: true }),
      );

      await expect(attempt).rejects.toMatchObject({ errorType: "ledger_controls_missing", retryable: false });
    } finally {
      await sql()`insert into private.execution_controls default values on conflict do nothing`;
    }
  });

  it("ledgerFunctions_calledAsSignedInUser_areDenied", async () => {
    const { error } = await users[0].client.rpc("reserve_execution_job", {
      p_job_id: crypto.randomUUID(),
      p_user_id: users[0].id,
      p_now: new Date().toISOString(),
      p_reserve_cpu_seconds: 60,
      p_expected_usage_version: 0,
    });

    expect(error?.code).toBe("42501");
  });
});
