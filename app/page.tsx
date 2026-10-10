import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { BudgetPicker } from "@/components/home/budget-picker";
import { InsightsCard } from "@/components/home/insights-card";
import { UnreviewedToggle } from "@/components/home/unreviewed-toggle";
import { Badge, Card, UnreviewedBadge } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/dal";
import { exerciseService, learningService } from "@/lib/server/container";
import { createUserClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const user = await requirePageUser("/");
  const supabase = await createUserClient();
  const [progress, active, insights, placement, profile] = await Promise.all([
    learningService().getProgress(user.userId),
    learningService().activeSession(user.userId),
    learningService().insights(user.userId),
    exerciseService().placement(user.userId),
    supabase.from("profiles").select("settings").eq("user_id", user.userId).single(),
  ]);
  const showUnreviewed = (profile.data?.settings as Record<string, unknown> | undefined)?.show_unreviewed_content === true;
  const due = progress.skills.filter((skill) => new Date(skill.reviewDueAt) <= new Date()).length;

  return (
    <>
      <AppHeader email={user.email} />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
            <p className="text-neutral-600 dark:text-neutral-400">Pick how long you have and CodeQuest plans the most useful work for it.</p>
          </div>
          <dl className="flex gap-6 text-sm">
            <div>
              <dt className="text-neutral-500 dark:text-neutral-400">XP</dt>
              <dd className="text-lg font-semibold" data-testid="xp-total">{progress.xp}</dd>
            </div>
            <div>
              <dt className="text-neutral-500 dark:text-neutral-400">Reviews due</dt>
              <dd className="text-lg font-semibold">{due}</dd>
            </div>
          </dl>
        </div>

        {active && (
          <Card className="flex flex-wrap items-center gap-3 border-indigo-300 dark:border-indigo-800">
            <div>
              <h2 className="font-semibold">Pick up where you left off</h2>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                Your {active.budgetMinutes}-minute session has {active.remaining} item{active.remaining === 1 ? "" : "s"} left.
              </p>
            </div>
            <Link href={`/sessions/${active.id}`} className="ml-auto rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
              Resume session
            </Link>
          </Card>
        )}

        {placement && !placement.taken && (
          <Card className="flex flex-wrap items-center gap-3">
            <div className="flex-1">
              <h2 className="font-semibold">New here? Start at Base Camp</h2>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">A {placement.diagnostic.estimatedMinutes}-minute adaptive check that suggests where to begin.</p>
            </div>
            <Link href="/base-camp" className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
              Go to Base Camp
            </Link>
          </Card>
        )}

        <InsightsCard insights={insights} />

        <Card>
          <h2 className="mb-3 font-semibold">How much time do you have?</h2>
          {progress.campaign.length === 0 ? (
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              No published content yet. Content becomes available once it has been reviewed — or turn on unreviewed drafts below.
            </p>
          ) : (
            <BudgetPicker />
          )}
        </Card>

        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <div className="flex flex-col gap-6">
            {progress.campaigns.length === 0 ? (
              <Card>
                <h2 className="mb-3 font-semibold">Quests</h2>
                <p className="text-sm text-neutral-600 dark:text-neutral-400">Nothing to show yet.</p>
              </Card>
            ) : (
              progress.campaigns.map((campaign) => (
                <Card key={campaign.id}>
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-semibold">
                      {campaign.title}
                      {campaign.kind === "project" ? " campaign" : ""}
                    </h2>
                    <span className="text-sm text-neutral-600 dark:text-neutral-400">
                      {campaign.quests.filter((quest) => quest.completed).length} of {campaign.quests.length} done
                    </span>
                  </div>
                  <p className="mb-2 text-sm text-neutral-600 dark:text-neutral-400">{campaign.summary}</p>
                  <ol className="divide-y divide-neutral-200 dark:divide-neutral-800">
                    {campaign.quests.map((quest) => (
                      <li key={quest.contentVersionId} className="flex flex-wrap items-center gap-3 py-2.5">
                        <span className="w-6 text-right text-sm text-neutral-500 dark:text-neutral-400">{quest.order}.</span>
                        <Link href={`/quests/${quest.contentVersionId}`} className="font-medium hover:underline">
                          {quest.title}
                        </Link>
                        <UnreviewedBadge status={quest.status} />
                        {quest.completed && <Badge tone="success">✓ Done</Badge>}
                      </li>
                    ))}
                  </ol>
                </Card>
              ))
            )}
          </div>
          <Card>
            <h2 className="mb-3 font-semibold">Content</h2>
            <UnreviewedToggle enabled={showUnreviewed} />
          </Card>
        </div>
      </main>
    </>
  );
}
