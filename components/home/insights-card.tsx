import Link from "next/link";
import { Card } from "@/components/ui";
import type { Insight } from "@/lib/learning/insights";

/** "What CodeQuest noticed" (spec §61): patterns in recent work, each with its evidence base. */
export function InsightsCard({ insights }: { insights: readonly Insight[] }) {
  if (insights.length === 0) return null;
  return (
    <Card>
      <h2 className="font-semibold">What CodeQuest noticed</h2>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">Patterns in your recent submissions. They describe the work, not you.</p>
      <ul className="mt-3 flex flex-col gap-3">
        {insights.map((entry) => (
          <li key={`${entry.code}:${entry.skillId ?? ""}`} className="text-sm">
            <p>{entry.message}</p>
            <p className="mt-0.5 text-xs text-neutral-500">
              Based on {entry.sampleSize} submissions in the last {entry.windowDays} days
              {entry.earlySignal ? " — an early signal; it may change as you do more." : "."}
            </p>
            {entry.recommendation && (
              <p className="mt-1">
                Try{" "}
                <Link href={`/quests/${entry.recommendation.contentVersionId}`} className="font-medium text-indigo-700 underline dark:text-indigo-300">
                  {entry.recommendation.title}
                </Link>
                : {entry.recommendation.why}.
              </p>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
