import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import { ExerciseRunner } from "@/components/exercises/exercise-runner";
import { Card } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/dal";
import { exerciseService } from "@/lib/server/container";

export const metadata: Metadata = { title: "Mixed practice · CodeQuest" };

/** Mixed mode (spec §25): no set names or topics; pick the approach yourself. */
export default async function MixedPracticePage() {
  const user = await requirePageUser("/practice/mixed");
  const items = await exerciseService().mixed(user.userId);

  return (
    <>
      <AppHeader email={user.email} />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Mixed practice</h1>
          <p className="text-neutral-600 dark:text-neutral-400">Questions from every area, shuffled, with no topic labels: deciding what kind of problem it is is part of the challenge.</p>
        </div>
        <Card>
          {items.length === 0 ? (
            <p className="text-sm text-neutral-600 dark:text-neutral-400">No practice sets are available yet.</p>
          ) : (
            <ExerciseRunner items={items} title="Mixed practice" neutralNames />
          )}
        </Card>
      </main>
    </>
  );
}
