import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { Badge, Card, UnreviewedBadge } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/dal";
import { exerciseService } from "@/lib/server/container";

export const metadata: Metadata = { title: "Practice · CodeQuest" };

const WORLD_NAMES: Record<string, string> = {
  "world.base-camp": "Base Camp",
  "world.java-awakening": "Java Awakening",
  "world.complexity-caverns": "Complexity Caverns",
  "world.data-structure-forge": "Data Structure Forge",
  "world.pattern-kingdom": "Pattern Kingdom",
  "world.algorithm-arena": "Algorithm Arena",
};

export default async function PracticePage() {
  const user = await requirePageUser("/practice");
  const sets = await exerciseService().listSets(user.userId);
  const worlds = [...new Set(sets.map((set) => set.world.id))];

  return (
    <>
      <AppHeader email={user.email} />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Practice</h1>
          <p className="text-neutral-600 dark:text-neutral-400">Short question sets: read code, predict output, size up complexity, pick an approach.</p>
        </div>
        {sets.length === 0 ? (
          <Card>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">No published practice sets yet. Turn on unreviewed drafts on the home page to see drafts.</p>
          </Card>
        ) : (
          worlds.map((world) => (
            <Card key={world}>
              <h2 className="mb-3 font-semibold">{WORLD_NAMES[world] ?? world}</h2>
              <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
                {sets
                  .filter((set) => set.world.id === world)
                  .map((set) => (
                    <li key={set.contentVersionId} className="flex flex-wrap items-center gap-3 py-2.5">
                      <Link href={`/practice/${set.contentVersionId}`} className="font-medium hover:underline">
                        {set.title}
                      </Link>
                      <UnreviewedBadge status={set.status} />
                      <Badge>
                        {set.questionCount} questions · ≈ {set.estimatedMinutes} min
                      </Badge>
                      <p className="w-full text-sm text-neutral-600 dark:text-neutral-400">{set.summary}</p>
                    </li>
                  ))}
              </ul>
            </Card>
          ))
        )}
      </main>
    </>
  );
}
