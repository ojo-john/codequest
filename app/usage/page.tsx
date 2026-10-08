import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import { Card } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/dal";
import { usageService } from "@/lib/server/container";
import { formatBytes, formatCpuTime, percentUsed, usageTone } from "@/lib/usage/format";

export const metadata: Metadata = { title: "Usage · CodeQuest" };

const BAR_TONE = { ok: "bg-indigo-600", warning: "bg-amber-500", full: "bg-red-600" } as const;
const resetFormat = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });

function UsageBar({ label, usedText, limitText, used, limit, detail }: { label: string; usedText: string; limitText: string; used: number; limit: number; detail?: string }) {
  const percent = percentUsed(used, limit);
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">{label}</h2>
        <span className="text-sm text-neutral-700 dark:text-neutral-300">
          {usedText} of {limitText}
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(used, limit)}
        aria-valuetext={`${usedText} of ${limitText}`}
        className="mt-2 h-2.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"
      >
        <div className={`h-full ${BAR_TONE[usageTone(percent)]}`} style={{ width: `${percent}%` }} />
      </div>
      {detail && <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{detail}</p>}
    </div>
  );
}

export default async function UsagePage() {
  const user = await requirePageUser("/usage");
  const { execution, database } = await usageService().usage(user.userId);

  return (
    <>
      <AppHeader email={user.email} />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Usage</h1>
          <p className="text-neutral-600 dark:text-neutral-400">
            CodeQuest runs on free tiers. It keeps itself inside a conservative allowance so the free quota is never exceeded. If a limit is reached, runs pause until it resets — your code is always saved.
          </p>
        </div>

        {execution.pausedUntil && (
          <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-950 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
            Code execution is paused until {resetFormat.format(execution.pausedUntil)} because the hosting provider&apos;s quota ran out. Your code is saved.
          </div>
        )}

        <Card className="flex flex-col gap-5">
          <UsageBar
            label="Code runs today"
            used={execution.jobsToday.used}
            limit={execution.jobsToday.limit}
            usedText={String(execution.jobsToday.used)}
            limitText={String(execution.jobsToday.limit)}
            detail={`Resets ${resetFormat.format(execution.jobsToday.resetsAt)}.`}
          />
          <UsageBar
            label="Code runs this month"
            used={execution.jobsThisMonth.used}
            limit={execution.jobsThisMonth.limit}
            usedText={String(execution.jobsThisMonth.used)}
            limitText={String(execution.jobsThisMonth.limit)}
            detail={`Resets ${resetFormat.format(execution.jobsThisMonth.resetsAt)}.`}
          />
          <UsageBar
            label="Compute time this month"
            used={execution.cpuSecondsThisMonth.used}
            limit={execution.cpuSecondsThisMonth.limit}
            usedText={formatCpuTime(execution.cpuSecondsThisMonth.used)}
            limitText={formatCpuTime(execution.cpuSecondsThisMonth.limit)}
            detail={`The allowance is ${percentUsed(execution.cpuSecondsThisMonth.limit, execution.providerCpuSecondsQuota)}% of the sandbox's free ${formatCpuTime(execution.providerCpuSecondsQuota)}, leaving headroom. A run that's still going counts at its maximum until it finishes.`}
          />
          {execution.runningJobs > 0 && <p className="text-sm">You have a run in progress.</p>}
        </Card>

        <Card>
          {database ? (
            <UsageBar
              label="Database"
              used={database.usedBytes}
              limit={database.limitBytes}
              usedText={formatBytes(database.usedBytes)}
              limitText={formatBytes(database.limitBytes)}
              detail="Supabase's free database size. Download an archive from Your data to keep a copy."
            />
          ) : (
            <p className="text-sm text-neutral-600 dark:text-neutral-400">The database size couldn&apos;t be read right now.</p>
          )}
        </Card>
      </main>
    </>
  );
}
