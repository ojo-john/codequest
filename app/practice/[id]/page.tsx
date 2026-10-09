import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { ExerciseRunner } from "@/components/exercises/exercise-runner";
import { Card, UnreviewedBadge } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/dal";
import { exerciseService } from "@/lib/server/container";
import { ApiError } from "@/lib/server/http";

export const metadata: Metadata = { title: "Practice · CodeQuest" };

export default async function PracticeSetPage({ params }: PageProps<"/practice/[id]">) {
  const { id } = await params;
  const user = await requirePageUser(`/practice/${id}`);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  let view;
  try {
    view = await exerciseService().getSet(user.userId, id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const { set, best } = view;

  return (
    <>
      <AppHeader email={user.email} />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{set.title}</h1>
          <UnreviewedBadge status={set.status} />
        </div>
        <Card>
          <ExerciseRunner contentVersionId={set.contentVersionId} title={set.title} questions={set.questions} best={best} />
        </Card>
      </main>
    </>
  );
}
