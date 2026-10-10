import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { DesignWorkspace } from "@/components/design/design-workspace";
import { requirePageUser } from "@/lib/auth/dal";
import { designPath } from "@/lib/exercises/design";
import { openProblemProject } from "@/lib/projects/campaign-project";
import { exerciseService } from "@/lib/server/container";
import { ApiError } from "@/lib/server/http";

export const metadata: Metadata = { title: "Design challenge · CodeQuest" };

export default async function DesignPage({ params }: PageProps<"/design/[id]">) {
  const { id } = await params;
  const user = await requirePageUser(`/design/${id}`);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  let view;
  try {
    view = await exerciseService().getSet(user.userId, id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const { set } = view;
  if (set.design === undefined) notFound();
  const design = set.design;
  // One document per section, kept in the learner's own project for this challenge.
  const starter = design.sections.map((section) => ({ path: designPath(section.id), content: `# ${section.title}\n\n` }));
  const project = await openProblemProject(user.userId, set.contentId, set.title, starter);

  return (
    <>
      <AppHeader email={user.email} wide />
      <DesignWorkspace
        title={set.title}
        design={design}
        project={project}
        probes={set.questions.map((question) => ({ contentVersionId: set.contentVersionId, question }))}
        contentVersionId={set.contentVersionId}
        sittingStartedAt={exerciseService().sittingStart().toISOString()}
      />
    </>
  );
}
