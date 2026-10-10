import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { ExerciseRunner } from "@/components/exercises/exercise-runner";
import { Card, UnreviewedBadge } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/dal";
import { exerciseService } from "@/lib/server/container";
import { ApiError } from "@/lib/server/http";

export const metadata: Metadata = { title: "Practice · CodeQuest" };

const UUID = /^[0-9a-f-]{36}$/;

export default async function PracticeSetPage({ params, searchParams }: PageProps<"/practice/[id]">) {
  const { id } = await params;
  const query = await searchParams;
  // Opened from a planned session: finishing the set completes that session item.
  const session = typeof query.session === "string" && typeof query.item === "string" && UUID.test(query.session) && UUID.test(query.item) ? { id: query.session, itemId: query.item } : undefined;
  const user = await requirePageUser(`/practice/${id}`);
  if (!UUID.test(id)) notFound();
  let view;
  try {
    view = await exerciseService().getSet(user.userId, id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const { set, best } = view;
  const sittingStartedAt = exerciseService().sittingStart().toISOString();

  return (
    <>
      <AppHeader email={user.email} />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{set.title}</h1>
          <UnreviewedBadge status={set.status} />
        </div>
        <Card>
          <ExerciseRunner items={set.questions.map((question) => ({ contentVersionId: set.contentVersionId, question }))} title={set.title} best={best} session={session} boss={set.boss ? { contentVersionId: set.contentVersionId, sittingStartedAt } : undefined} />
        </Card>
      </main>
    </>
  );
}
