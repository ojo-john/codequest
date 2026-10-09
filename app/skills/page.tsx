import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { DIMENSION_NAMES, formatDate, STATE_TONE } from "@/components/skills/skill-labels";
import { SkillGraph } from "@/components/skills/skill-graph";
import { Badge, Card } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/dal";
import { skillTreeService } from "@/lib/server/container";

export const metadata: Metadata = { title: "Skill tree · CodeQuest" };

/** The skill tree (spec §39): list view first — it's the accessible, complete view. */
export default async function SkillsPage() {
  const user = await requirePageUser("/skills");
  const worlds = await skillTreeService().tree(user.userId);

  return (
    <>
      <AppHeader email={user.email} />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Skill tree</h1>
          <p className="text-neutral-600 dark:text-neutral-400">
            Each skill is tracked per dimension (concept, recognition, coding, complexity, explanation). Solid arrows are strict prerequisites; dashed ones are a suggested order.
          </p>
        </div>

        <details className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <summary className="cursor-pointer font-medium">Show as a graph</summary>
          <SkillGraph worlds={worlds} />
        </details>

        {worlds.map((world) => (
          <Card key={world.id}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">
                World {world.number}: {world.name}
              </h2>
              {!world.available && <Badge>Coming later</Badge>}
            </div>
            <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400">{world.summary}</p>
            {world.skills.length === 0 ? (
              <p className="text-sm text-neutral-600 dark:text-neutral-400">No skills here yet.</p>
            ) : (
              <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
                {world.skills.map((skill) => (
                  <li key={skill.id} className="flex flex-col gap-1 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/skills/${skill.id}`} className="font-medium hover:underline">
                        {skill.name}
                      </Link>
                      {skill.dimensions.length === 0 ? (
                        <Badge>Not started</Badge>
                      ) : (
                        skill.dimensions.map((dimension) => (
                          <Badge key={dimension.dimension} tone={STATE_TONE[dimension.state]}>
                            {DIMENSION_NAMES[dimension.dimension] ?? dimension.dimension}: {dimension.state}
                          </Badge>
                        ))
                      )}
                    </div>
                    <p className="text-xs text-neutral-600 dark:text-neutral-400">
                      {skill.evidenceCount} piece{skill.evidenceCount === 1 ? "" : "s"} of evidence · last practised {formatDate(skill.lastPracticedAt)} · next review {formatDate(skill.nextReviewAt)}
                      {skill.prerequisites.length > 0 && <> · needs {skill.prerequisites.map((prerequisite) => `${prerequisite.name}${prerequisite.kind === "recommended" ? " (suggested)" : ""}`).join(", ")}</>}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </main>
    </>
  );
}
