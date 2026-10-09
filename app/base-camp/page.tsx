import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { DiagnosticRunner } from "@/components/exercises/diagnostic-runner";
import { Badge, Card } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/dal";
import type { Placement } from "@/lib/exercises/diagnostic";
import { exerciseService } from "@/lib/server/container";

export const metadata: Metadata = { title: "Base Camp · CodeQuest" };

const PLACEMENT: Record<Placement, { label: string; tone: "success" | "info" | "neutral"; advice: string }> = {
  strong: { label: "Looks solid", tone: "success", advice: "A quick review is enough before moving on. Nothing is skipped." },
  start_here: { label: "Start here", tone: "info", advice: "Worth working through properly." },
  not_assessed: { label: "Not reached", tone: "neutral", advice: "The check stopped before this area." },
};

/** Base Camp (spec §3): an adaptive check that suggests where to start, never what to skip. */
export default async function BaseCampPage({ searchParams }: PageProps<"/base-camp">) {
  const user = await requirePageUser("/base-camp");
  const running = (await searchParams).run === "1";
  const service = exerciseService();
  const placement = await service.placement(user.userId);

  return (
    <>
      <AppHeader email={user.email} />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Base Camp</h1>
          <p className="text-neutral-600 dark:text-neutral-400">
            A short adaptive check. It gets harder while you&apos;re doing well and moves on after two misses in an area. It suggests where to start; it never hides the fundamentals.
          </p>
        </div>
        {placement === undefined ? (
          <Card>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">The Base Camp check isn&apos;t published yet. Turn on unreviewed drafts on the home page to try the draft.</p>
          </Card>
        ) : running ? (
          <Card>
            <DiagnosticRunnerLoader userId={user.userId} contentVersionId={placement.diagnostic.contentVersionId} />
          </Card>
        ) : (
          <>
            <Card className="flex flex-wrap items-center gap-3">
              <p className="flex-1 text-sm">
                {placement.taken ? "Your placement is below. You can take the check again any time; your best answers count." : `About ${placement.diagnostic.estimatedMinutes} minutes. Answers count as light evidence and earn no XP.`}
              </p>
              <Link href="/base-camp?run=1" className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
                {placement.taken ? "Take it again" : "Start the check"}
              </Link>
            </Card>
            {placement.taken && (
              <Card>
                <h2 className="mb-3 font-semibold">Your placement</h2>
                <ul className="flex flex-col gap-3">
                  {placement.sections.map((section) => (
                    <li key={section.sectionId} className="text-sm">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{section.name}</span>
                        <Badge tone={PLACEMENT[section.placement].tone}>{PLACEMENT[section.placement].label}</Badge>
                        <span className="text-neutral-600 dark:text-neutral-400">
                          {section.asked === 0 ? "no questions answered" : `${section.correct} of ${section.asked} correct${section.partial > 0 ? `, ${section.partial} partly` : ""}`}
                        </span>
                      </p>
                      <p className="text-neutral-600 dark:text-neutral-400">
                        {PLACEMENT[section.placement].advice}
                        {section.startWith && (
                          <>
                            {" "}
                            Begin with{" "}
                            <Link href={`/practice/${section.startWith.contentVersionId}`} className="font-medium text-indigo-700 underline dark:text-indigo-300">
                              {section.startWith.title}
                            </Link>
                            .
                          </>
                        )}
                        {!section.startWith && " Practice for this area comes in a later update."}
                      </p>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-neutral-600 dark:text-neutral-400">
                  Coding placement comes from your first quest (Checkout totals); system design arrives in a later world. A handful of questions per area is a rough guide, not a verdict.
                </p>
              </Card>
            )}
          </>
        )}
      </main>
    </>
  );
}

async function DiagnosticRunnerLoader({ userId, contentVersionId }: { userId: string; contentVersionId: string }) {
  const { set } = await exerciseService().getSet(userId, contentVersionId);
  return <DiagnosticRunner contentVersionId={set.contentVersionId} questions={set.questions} sections={set.sections ?? []} />;
}
