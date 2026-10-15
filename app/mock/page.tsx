import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { OVERALL } from "@/components/mock/mock-result";
import { StartMock } from "@/components/mock/start-mock";
import { Card } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/dal";
import { MOCK_DISCLAIMER } from "@/lib/interview/mock-scoring";
import { mockService } from "@/lib/server/container";

export const metadata: Metadata = { title: "Mock interviews · CodeQuest" };

export default async function MockPage() {
  const user = await requirePageUser("/mock");
  const { running, past } = await mockService().recent(user.userId);

  return (
    <>
      <AppHeader email={user.email} />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
        <h1 className="text-2xl font-semibold tracking-tight">Mock interviews</h1>
        <p className="text-sm text-neutral-700 dark:text-neutral-300">
          A timed coding interview on a problem you haven&apos;t attempted. Hints, notes, follow-up answers and the rubric are off until it ends; you plan out loud (in
          writing), then code. {MOCK_DISCLAIMER}
        </p>
        <Card>
          {running ? (
            <p>
              You have a mock in progress.{" "}
              <Link href={`/mock/${running.id}`} className="font-medium text-indigo-700 hover:underline dark:text-indigo-300">
                Return to it
              </Link>
              .
            </p>
          ) : (
            <StartMock />
          )}
        </Card>
        <section aria-labelledby="past-title">
          <h2 id="past-title" className="mb-2 font-semibold">
            Past mocks
          </h2>
          {past.length === 0 ? (
            <p className="text-sm text-neutral-600 dark:text-neutral-400">None yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {past.map((mock) => (
                <li key={mock.id}>
                  <Link href={`/mock/${mock.id}`} className="font-medium hover:underline">
                    {mock.problem.title}
                  </Link>{" "}
                  <span className="text-sm text-neutral-600 dark:text-neutral-400">
                    · {mock.durationMinutes} min · {mock.result ? OVERALL[mock.result.overall] : ""} · {new Date(mock.startedAt).toLocaleDateString("en", { dateStyle: "medium" })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
