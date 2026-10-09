import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { DIMENSION_NAMES, formatDate, STATE_TONE } from "@/components/skills/skill-labels";
import { Badge, Card } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/dal";
import { MIN_EVIDENCE_FOR_MASTERY } from "@/lib/learning/mastery";
import { skillTreeService } from "@/lib/server/container";

export const metadata: Metadata = { title: "Skill · CodeQuest" };

/** Skill detail (spec §39): estimates per dimension, practice history, prerequisites, next tasks. */
export default async function SkillPage({ params }: PageProps<"/skills/[id]">) {
  const { id } = await params;
  const user = await requirePageUser(`/skills/${id}`);
  if (!/^[a-z0-9]+(\.[a-z0-9-]+)*$/.test(id)) notFound();
  const found = await skillTreeService().skill(user.userId, id);
  if (found === undefined) notFound();
  const { world, skill } = found;

  return (
    <>
      <AppHeader email={user.email} />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
        <div>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            <Link href="/skills" className="hover:underline">
              Skill tree
            </Link>{" "}
            › World {world.number}: {world.name}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">{skill.name}</h1>
          <p className="mt-1 text-neutral-700 dark:text-neutral-300">{skill.definition}</p>
        </div>

        <Card>
          <h2 className="mb-2 font-semibold">Your estimates</h2>
          {skill.dimensions.length === 0 ? (
            <p className="text-sm text-neutral-600 dark:text-neutral-400">No evidence yet. The tasks below are a good start.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-neutral-600 dark:text-neutral-400">
                    <th className="py-1 pr-3 font-medium">Dimension</th>
                    <th className="py-1 pr-3 font-medium">State</th>
                    <th className="py-1 pr-3 font-medium">Estimate</th>
                    <th className="py-1 pr-3 font-medium">Evidence</th>
                    <th className="py-1 pr-3 font-medium">Last practised</th>
                    <th className="py-1 font-medium">Next review</th>
                  </tr>
                </thead>
                <tbody>
                  {skill.dimensions.map((dimension) => (
                    <tr key={dimension.dimension} className="border-t border-neutral-100 dark:border-neutral-800">
                      <td className="py-1.5 pr-3">{DIMENSION_NAMES[dimension.dimension] ?? dimension.dimension}</td>
                      <td className="py-1.5 pr-3">
                        <Badge tone={STATE_TONE[dimension.state]}>{dimension.state}</Badge>
                      </td>
                      <td className="py-1.5 pr-3">{Math.round(dimension.estimate * 100)}%</td>
                      <td className="py-1.5 pr-3">
                        {dimension.evidenceCount}
                        {dimension.evidenceCount < MIN_EVIDENCE_FOR_MASTERY && <span className="text-neutral-600 dark:text-neutral-400"> (not enough yet)</span>}
                      </td>
                      <td className="py-1.5 pr-3">{formatDate(dimension.lastPracticedAt)}</td>
                      <td className="py-1.5">{formatDate(dimension.nextReviewAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">Learning estimates from your graded work, not exact probabilities. Understanding a skill and coding it are tracked separately.</p>
        </Card>

        <Card>
          <h2 className="mb-2 font-semibold">Recommended next</h2>
          {skill.recommended.length === 0 ? (
            <p className="text-sm text-neutral-600 dark:text-neutral-400">No available tasks practise this skill yet.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {skill.recommended.map((task) => (
                <li key={task.contentVersionId} className="flex flex-wrap items-center gap-2">
                  <Link href={task.kind === "quest" ? `/quests/${task.contentVersionId}` : `/practice/${task.contentVersionId}`} className="font-medium text-indigo-700 hover:underline dark:text-indigo-300">
                    {task.title}
                  </Link>
                  <Badge>{task.kind === "quest" ? "Coding quest" : "Practice set"}</Badge>
                  {task.completed && <Badge tone="success">Done before</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="mb-2 font-semibold">Prerequisites</h2>
          {skill.prerequisites.length === 0 ? (
            <p className="text-sm text-neutral-600 dark:text-neutral-400">None: a starting point.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {skill.prerequisites.map((prerequisite) => (
                <li key={prerequisite.id}>
                  <Link href={`/skills/${prerequisite.id}`} className="hover:underline">
                    {prerequisite.name}
                  </Link>{" "}
                  <span className="text-neutral-600 dark:text-neutral-400">{prerequisite.kind === "strict" ? "— required first" : "— suggested order"}</span>
                </li>
              ))}
            </ul>
          )}
          {skill.unlocks.length > 0 && (
            <p className="mt-2 text-sm">
              Leads to:{" "}
              {skill.unlocks.map((unlock, index) => (
                <span key={unlock.id}>
                  {index > 0 && ", "}
                  <Link href={`/skills/${unlock.id}`} className="hover:underline">
                    {unlock.name}
                  </Link>
                </span>
              ))}
            </p>
          )}
        </Card>
      </main>
    </>
  );
}
