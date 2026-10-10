import { Badge, Card } from "@/components/ui";
import type { ReadinessLevel } from "@/lib/learning/readiness";
import type { DashboardView, Ratio } from "@/lib/server/dashboard-service";

const LEVEL: Record<ReadinessLevel, { label: string; tone: "neutral" | "info" | "success" }> = {
  building: { label: "Building", tone: "neutral" },
  developing: { label: "Developing", tone: "info" },
  strong: { label: "Strong", tone: "success" },
};

function ratio(value: Ratio): string {
  if (value.outOf === 0) return "no evidence yet";
  return `${Math.round((value.count / value.outOf) * 100)}% (${value.count} of ${value.outOf})`;
}

function minutes(seconds: number): string {
  return seconds < 90 ? `${Math.round(seconds)} s` : `${Math.round(seconds / 60)} min`;
}

/** Readiness per track (spec §41): never a number without enough evidence behind it. */
export function ReadinessCard({ view }: { view: DashboardView }) {
  return (
    <Card>
      <h2 className="font-semibold">Interview readiness</h2>
      <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400">
        Separate from XP. Every skill in a track counts (untouched ones as zero), harder skills weigh more, and long-overdue skills count half, so practising one easy thing can&apos;t inflate it.
      </p>
      <ul className="flex flex-col gap-2 text-sm">
        {view.readiness.map((track) => (
          <li key={track.id} className="flex flex-wrap items-center gap-2">
            <span className="w-52 font-medium">{track.name}</span>
            {track.status === "scored" && track.level && track.score !== undefined ? (
              <>
                <Badge tone={LEVEL[track.level].tone}>{LEVEL[track.level].label}</Badge>
                <span className="text-neutral-600 dark:text-neutral-400">
                  {Math.round(track.score * 100)}% · evidence on {track.evidencedSkills} of {track.skillCount} skills
                </span>
              </>
            ) : (
              <span className="text-neutral-600 dark:text-neutral-400">
                Not enough evidence yet{track.skillCount > 0 ? `: practise ${track.skillsStillNeeded} more skill${track.skillsStillNeeded === 1 ? "" : "s"} (${track.evidencedSkills} of ${track.skillCount} so far)` : ""}
              </span>
            )}
          </li>
        ))}
        {view.unavailableTracks.map((name) => (
          <li key={name} className="flex flex-wrap items-center gap-2">
            <span className="w-52 font-medium">{name}</span>
            <span className="text-neutral-600 dark:text-neutral-400">Not available yet</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-neutral-600 dark:text-neutral-400">Not yet included: timed and unseen problems, communication and mock interviews (later worlds).</p>
    </Card>
  );
}

/** The learner's numbers (spec §40), each with its sample size. */
export function StatsCard({ view }: { view: DashboardView }) {
  const rows: Array<[string, string]> = [
    ["Coding problems solved", `${view.problems.solved} of ${view.problems.attempted} attempted`],
    ["Distinct problems solved", `${view.problems.families} (variants of one problem count once)`],
    ["Solved without hints", String(view.problems.independent)],
    ["Passed on the first submission", ratio(view.problems.firstAttempt)],
    ["Typical solve time", view.medianSolveSeconds.value === null ? "no solves yet" : `${minutes(view.medianSolveSeconds.value)} (median of ${view.medianSolveSeconds.sample})`],
    ["Pattern recognition accuracy", ratio(view.recognition)],
    ["Big-O accuracy", ratio(view.complexity)],
  ];
  return (
    <Card>
      <h2 className="mb-3 font-semibold">Your numbers</h2>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-neutral-600 dark:text-neutral-400">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      {(view.weakest.length > 0 || view.strongest.length > 0) && (
        <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <h3 className="font-medium">Weakest so far</h3>
            <ul className="mt-1 list-disc pl-5">
              {view.weakest.map((skill) => (
                <li key={skill.skillId}>
                  {skill.name}: {Math.round(skill.estimate * 100)}% ({skill.evidence} pieces of evidence)
                </li>
              ))}
            </ul>
          </div>
          {view.strongest.length > 0 && (
            <div>
              <h3 className="font-medium">Strongest so far</h3>
              <ul className="mt-1 list-disc pl-5">
                {view.strongest.map((skill) => (
                  <li key={skill.skillId}>
                    {skill.name}: {Math.round(skill.estimate * 100)}% ({skill.evidence} pieces of evidence)
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {view.recent.length > 0 && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-medium">Recent evidence</summary>
          <ul className="mt-1 flex flex-col gap-0.5">
            {view.recent.map((entry, index) => (
              <li key={`${entry.at}-${index}`}>
                {entry.outcome === "pass" ? "✓" : entry.outcome === "partial" ? "◐" : "✗"} {entry.skill} ({entry.dimension}){entry.independence !== "independent" ? `, ${entry.independence.replace("_", " ")}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
