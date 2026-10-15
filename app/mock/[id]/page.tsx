import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { MockResultView } from "@/components/mock/mock-result";
import { MockRoom } from "@/components/mock/mock-room";
import { requirePageUser } from "@/lib/auth/dal";
import { openQuestProject } from "@/lib/projects/campaign-project";
import { learningService, mockService } from "@/lib/server/container";
import { ApiError } from "@/lib/server/http";

export const metadata: Metadata = { title: "Mock interview · CodeQuest" };

const UUID = /^[0-9a-f-]{36}$/;

export default async function MockInterviewPage({ params }: PageProps<"/mock/[id]">) {
  const { id } = await params;
  const user = await requirePageUser(`/mock/${id}`);
  if (!UUID.test(id)) notFound();
  let mock;
  try {
    mock = await mockService().get(user.userId, id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  if (mock.state === "finished" && mock.result) {
    return (
      <>
        <AppHeader email={user.email} />
        <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
          <h1 className="text-2xl font-semibold tracking-tight">Mock interview result</h1>
          <MockResultView result={mock.result} problemTitle={mock.problem.title} />
          <p className="text-sm">
            <Link href={`/quests/${mock.problem.contentVersionId}`} className="text-indigo-700 underline dark:text-indigo-300">
              Open the problem with hints and follow-ups
            </Link>{" "}
            ·{" "}
            <Link href="/mock" className="text-indigo-700 underline dark:text-indigo-300">
              All mocks
            </Link>
          </p>
        </main>
      </>
    );
  }

  const quest = await learningService().getQuest(user.userId, mock.problem.contentVersionId);
  const campaign = await learningService().campaignOf(quest.campaign.id);
  const project = await openQuestProject(user.userId, { contentId: quest.contentId, title: quest.title, campaignId: quest.campaign.id, starter: quest.starter }, campaign);

  return (
    <>
      <AppHeader email={user.email} wide />
      <MockRoom
        mockId={mock.id}
        endsAt={mock.endsAt}
        plan={mock.plan}
        workspace={{
          quest: {
            contentVersionId: quest.contentVersionId,
            title: quest.title,
            summary: quest.summary,
            status: quest.status,
            stage: quest.stage,
            estimatedMinutes: quest.estimatedMinutes,
            instructions: quest.instructions,
            hintsUsed: 0,
            hintsAvailable: 0,
            usedHints: [],
            sampleCount: quest.samples.length,
          },
          starter: quest.starter,
          project,
          journal: { noteBody: "" },
        }}
      />
    </>
  );
}
