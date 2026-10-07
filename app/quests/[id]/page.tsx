import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { QuestWorkspace } from "@/components/workspace/quest-workspace";
import { requirePageUser } from "@/lib/auth/dal";
import { openCampaignProject } from "@/lib/projects/campaign-project";
import { learningService } from "@/lib/server/container";
import { ApiError } from "@/lib/server/http";

const CAMPAIGN_TITLES: Record<string, string> = { "campaign.shopping-cart": "Shopping cart" };

export default async function QuestPage({ params, searchParams }: PageProps<"/quests/[id]">) {
  const { id } = await params;
  const user = await requirePageUser(`/quests/${id}`);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();

  let quest;
  try {
    quest = await learningService().getQuest(user.userId, id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const project = await openCampaignProject(user.userId, quest.campaign.id, CAMPAIGN_TITLES[quest.campaign.id] ?? quest.campaign.id, quest.starter);
  const item = (await searchParams).item;

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
        sessionItemId={typeof item === "string" && /^[0-9a-f-]{36}$/.test(item) ? item : undefined}
      />
    </>
  );
}
