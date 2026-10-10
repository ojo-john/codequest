import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { QuestWorkspace } from "@/components/workspace/quest-workspace";
import { requirePageUser } from "@/lib/auth/dal";
import { openQuestProject } from "@/lib/projects/campaign-project";
import { journalService, learningService } from "@/lib/server/container";
import { ApiError } from "@/lib/server/http";

const UUID = /^[0-9a-f-]{36}$/;

/** The planned session this quest was opened from; the database ignores items that aren't the learner's. */
function sessionRef(session: unknown, item: unknown): { id: string; itemId: string } | undefined {
  if (typeof session !== "string" || typeof item !== "string" || !UUID.test(session) || !UUID.test(item)) return undefined;
  return { id: session, itemId: item };
}


export default async function QuestPage({ params, searchParams }: PageProps<"/quests/[id]">) {
  const { id } = await params;
  const user = await requirePageUser(`/quests/${id}`);
  if (!UUID.test(id)) notFound();

  let quest;
  try {
    quest = await learningService().getQuest(user.userId, id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const [project, journal] = await Promise.all([
    learningService()
      .campaignOf(quest.campaign.id)
      .then((campaign) => openQuestProject(user.userId, { contentId: quest.contentId, title: quest.title, campaignId: quest.campaign.id, starter: quest.starter }, campaign)),
    journalService().questJournal(user.userId, id),
  ]);
  const query = await searchParams;
  const session = sessionRef(query.session, query.item);

  return (
    <>
      <AppHeader email={user.email} wide />
      <QuestWorkspace
        quest={{
          contentVersionId: quest.contentVersionId,
          title: quest.title,
          summary: quest.summary,
          status: quest.status,
          stage: quest.stage,
          estimatedMinutes: quest.estimatedMinutes,
          instructions: quest.instructions,
          hintsUsed: quest.hintsUsed,
          hintsAvailable: quest.hintsAvailable,
          usedHints: quest.usedHints,
          sampleCount: quest.samples.length,
        }}
        starter={quest.starter}
        project={project}
        session={session}
        journal={{
          noteBody: journal.note?.body ?? "",
          reflection: journal.reflection && { answers: journal.reflection.answers, createdAt: journal.reflection.createdAt, retrievalDue: journal.reflection.retrievalDue },
        }}
      />
    </>
  );
}
