"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { Badge, Button, Card } from "@/components/ui";
import { apiCall, ClientApiError } from "@/lib/client/api";
import { DAILY_SECONDS, FREEZES_PER_MONTH, BUSY_SECONDS, type Pause, type Streak } from "@/lib/engagement/streaks";
import type { AchievementProgress } from "@/lib/engagement/achievements";

/** The browser's zone; undefined while rendering on the server, so hydration matches. */
const noSubscription = () => () => {};
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const serverZone = () => undefined;

const field = "rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-700";

export function StreakCard({ streak, message, pauses, timeZone, today }: { streak: Streak; message: string; pauses: readonly Pause[]; timeZone: string; today: string }) {
  const router = useRouter();
  const deviceZone = useSyncExternalStore(noSubscription, browserZone, serverZone);
  const [kind, setKind] = useState<Pause["kind"]>("vacation");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function act(run: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await run();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "Couldn't save that.");
    } finally {
      setBusy(false);
    }
  }

  const minutesToday = Math.floor(streak.todaySeconds / 60);
  return (
    <Card>
      <h2 className="font-semibold">Streak</h2>
      <p className="mt-1" data-testid="streak-message">
        {message}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-neutral-600 dark:text-neutral-400">Current</dt>
          <dd className="text-lg font-semibold" data-testid="streak-current">
            {streak.current} day{streak.current === 1 ? "" : "s"}
          </dd>
        </div>
        <div>
          <dt className="text-neutral-600 dark:text-neutral-400">Longest</dt>
          <dd className="text-lg font-semibold">{streak.longest}</dd>
        </div>
        <div>
          <dt className="text-neutral-600 dark:text-neutral-400">Today</dt>
          <dd className="text-lg font-semibold">
            {Math.min(minutesToday, streak.todayTarget / 60)} of {streak.todayTarget / 60} min
          </dd>
        </div>
        <div>
          <dt className="text-neutral-600 dark:text-neutral-400">Freezes left</dt>
          <dd className="text-lg font-semibold">
            {streak.freezesLeft} of {FREEZES_PER_MONTH}
          </dd>
        </div>
      </dl>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-medium">How streaks work</summary>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-neutral-700 dark:text-neutral-300">
          <li>A day counts after {DAILY_SECONDS / 60} minutes of active practice (answering, running or submitting), in your time zone.</li>
          <li>A missed day uses a freeze automatically while you have one left this month ({FREEZES_PER_MONTH} a month, not carried over). After that, a missed day starts the streak again.</li>
          <li>Vacation days are paused: they don&apos;t count and don&apos;t break anything. A busy week lowers the bar to {BUSY_SECONDS / 60} minutes a day for 7 days.</li>
          <li>Pauses start today or later; they can&apos;t be backdated.</li>
        </ul>
      </details>

      <p className="mt-3 text-sm">
        Days are counted in <strong>{timeZone}</strong>.
        {deviceZone && deviceZone !== timeZone && (
          <>
            {" "}
            <Button variant="ghost" disabled={busy} onClick={() => void act(() => apiCall("/api/v1/engagement/timezone", { method: "PUT", body: { timeZone: deviceZone } }))}>
              Use this device&apos;s ({deviceZone})
            </Button>
          </>
        )}
      </p>

      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void act(() => apiCall("/api/v1/engagement/pauses", { method: "POST", body: kind === "vacation" ? { kind, from, to } : { kind, from } }));
        }}
      >
        <label className="flex flex-col text-sm">
          Pause
          <select value={kind} onChange={(event) => setKind(event.target.value as Pause["kind"])} className={field}>
            <option value="vacation">Vacation</option>
            <option value="busy_week">Busy week</option>
          </select>
        </label>
        <label className="flex flex-col text-sm">
          From
          <input type="date" min={today} value={from} onChange={(event) => setFrom(event.target.value)} className={field} />
        </label>
        {kind === "vacation" && (
          <label className="flex flex-col text-sm">
            To
            <input type="date" min={from} value={to} onChange={(event) => setTo(event.target.value)} className={field} />
          </label>
        )}
        <Button type="submit" disabled={busy}>
          Add pause
        </Button>
      </form>
      {pauses.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {pauses.map((pause) => (
            <li key={pause.from} className="flex flex-wrap items-center gap-2">
              <Badge tone="info">{pause.kind === "vacation" ? "Vacation" : "Busy week"}</Badge>
              {pause.from} to {pause.to}
              <Button variant="ghost" disabled={busy} onClick={() => void act(() => apiCall(`/api/v1/engagement/pauses?from=${pause.from}`, { method: "DELETE" }))}>
                {pause.from <= today ? "End now" : "Cancel"}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </Card>
  );
}

export function AchievementsCard({ achievements }: { achievements: ReadonlyArray<AchievementProgress & { awardedAt?: string }> }) {
  return (
    <Card>
      <h2 className="font-semibold">Achievements</h2>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">Earned from independent work only: no hints, no revealed solutions, never time or lines typed.</p>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {achievements.map((achievement) => (
          <li key={achievement.id} className="rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{achievement.name}</span>
              {achievement.awardedAt && <Badge tone="success">Earned {new Date(achievement.awardedAt).toLocaleDateString("en", { dateStyle: "medium" })}</Badge>}
            </div>
            <p className="text-sm text-neutral-700 dark:text-neutral-300">{achievement.description}</p>
            {!achievement.awardedAt && (
              <div className="mt-1 flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400">
                <progress value={achievement.progress} max={achievement.target} aria-label={`${achievement.name} progress`} className="h-2 flex-1" />
                {achievement.progress} / {achievement.target}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
