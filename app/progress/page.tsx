import { AppHeader } from "@/components/app-header";
import { Badge, Card } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/dal";
import { MIN_EVIDENCE_FOR_MASTERY } from "@/lib/learning/mastery";
import { learningService } from "@/lib/server/container";
import { createUserClient } from "@/lib/supabase/server";

const STATE_TONE = { new: "neutral", learning: "info", developing: "info", strong: "success", mastered: "success", rusty: "warning" } as const;

const dateFormat = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

export default async function ProgressPage() {
  const user = await requirePageUser("/progress");
  const supabase = await createUserClient();
  const [progress, skills] = await Promise.all([learningService().getProgress(user.userId), supabase.from("skills").select("id, name")]);
  const names = new Map((skills.data ?? []).map((skill) => [skill.id as string, skill.name as string]));
  const sorted = [...progress.skills].sort((a, b) => a.reviewDueAt.localeCompare(b.reviewDueAt));
  const now = new Date();

  return (
    <>
      <AppHeader email={user.email} />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Progress</h1>
          <p className="text-neutral-600 dark:text-neutral-400">
            Estimates come from your graded submissions. They&apos;re learning estimates, not exact probabilities — XP is shown separately and never counts toward them.
          </p>
        </div>
        <Card>
          <dl className="flex flex-wrap gap-8 text-sm">
            <div>
              <dt className="text-neutral-500 dark:text-neutral-400">XP</dt>
              <dd className="text-lg font-semibold">{progress.xp}</dd>
            </div>
            <div>
              <dt className="text-neutral-500 dark:text-neutral-400">Quests completed</dt>
              <dd className="text-lg font-semibold">
                {progress.campaign.filter((quest) => quest.completed).length} / {progress.campaign.length}
              </dd>
            </div>
            <div>
              <dt className="text-neutral-500 dark:text-neutral-400">Skills with evidence</dt>
              <dd className="text-lg font-semibold">{progress.skills.length}</dd>
            </div>
          </dl>
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Skills</h2>
          {sorted.length === 0 ? (
            <p className="text-sm text-neutral-600 dark:text-neutral-400">No evidence yet — submit a quest to see your skills here.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left dark:border-neutral-800">
                    <th className="py-2 pr-4 font-medium">Skill</th>
                    <th className="py-2 pr-4 font-medium">Dimension</th>
                    <th className="py-2 pr-4 font-medium">State</th>
                    <th className="py-2 pr-4 font-medium">Estimate</th>
                    <th className="py-2 pr-4 font-medium">Evidence</th>
                    <th className="py-2 font-medium">Next review</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((skill) => {
                    const due = new Date(skill.reviewDueAt);
                    return (
                      <tr key={`${skill.skillId}:${skill.dimension}`} className="border-b border-neutral-100 dark:border-neutral-900">
                        <td className="py-2 pr-4">{names.get(skill.skillId) ?? skill.skillId}</td>
                        <td className="py-2 pr-4 capitalize">{skill.dimension}</td>
                        <td className="py-2 pr-4">
                          <Badge tone={STATE_TONE[skill.state]}>{skill.state}</Badge>
                        </td>
                        <td className="py-2 pr-4">{Math.round(skill.estimate * 100)}%</td>
                        <td className="py-2 pr-4">
                          {skill.evidenceCount}
                          {skill.evidenceCount < MIN_EVIDENCE_FOR_MASTERY && <span className="text-neutral-500 dark:text-neutral-400"> (not enough yet)</span>}
                        </td>
                        <td className="py-2">{due <= now ? <Badge tone="warning">due now</Badge> : dateFormat.format(due)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </main>
    </>
  );
}
