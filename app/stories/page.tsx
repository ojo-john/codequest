import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { NewStory } from "@/components/stories/new-story";
import { Badge, Card } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/dal";
import { storyService } from "@/lib/server/container";

export const metadata: Metadata = { title: "Behavioral stories · CodeQuest" };

export default async function StoriesPage() {
  const user = await requirePageUser("/stories");
  const { stories, coverage, questions, limit } = await storyService().overview(user.userId);
  const gaps = coverage.filter((entry) => entry.stories.length === 0);

  return (
    <>
      <AppHeader email={user.email} />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
        <h1 className="text-2xl font-semibold tracking-tight">Behavioral stories</h1>
        <p className="text-sm text-neutral-700 dark:text-neutral-300">
          Build a bank of true stories in STAR form (situation, task, action, result), tagged with what each one shows. CodeQuest checks structure and coverage; it never writes,
          embellishes or adds numbers to your stories.
        </p>
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Your stories</h2>
            {stories.length < limit && <NewStory />}
          </div>
          {stories.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">No stories yet. Six to eight good ones cover most interviews.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {stories.map((story) => (
                <li key={story.id} className="flex flex-wrap items-center gap-2">
                  <Link href={`/stories/${story.id}`} className="font-medium hover:underline">
                    {story.title}
                  </Link>
                  {story.suggestions > 0 && <Badge tone="warning">{story.suggestions} to improve</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h2 className="mb-2 font-semibold">Coverage</h2>
          <p className="mb-2 text-sm text-neutral-600 dark:text-neutral-400">
            {gaps.length === 0 ? "Every competency has at least one story." : `${coverage.length - gaps.length} of ${coverage.length} competencies have a story.`}
          </p>
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {coverage.map((entry) => (
              <li key={entry.id} className="flex items-center gap-2">
                <Badge tone={entry.stories.length > 0 ? "success" : "neutral"}>{entry.stories.length}</Badge>
                {entry.name}
              </li>
            ))}
          </ul>
        </Card>
        <section aria-labelledby="questions-title">
          <h2 id="questions-title" className="mb-2 font-semibold">
            Common questions
          </h2>
          <p className="mb-2 text-sm text-neutral-600 dark:text-neutral-400">Pick one, choose a story, and tell it out loud in 1 to 3 minutes.</p>
          <ul className="flex flex-col gap-2">
            {questions.map((question) => (
              <li key={question.prompt}>
                <Card>
                  <p className="font-medium">{question.prompt}</p>
                  <p className="mt-1 text-sm">
                    {question.stories.length === 0 ? (
                      <span className="text-neutral-600 dark:text-neutral-400">No story tagged for this yet.</span>
                    ) : (
                      <>
                        Your stories:{" "}
                        {question.stories.map((story, index) => (
                          <span key={story.id}>
                            {index > 0 && ", "}
                            <Link href={`/stories/${story.id}`} className="text-indigo-700 underline dark:text-indigo-300">
                              {story.title}
                            </Link>
                          </span>
                        ))}
                      </>
                    )}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}
