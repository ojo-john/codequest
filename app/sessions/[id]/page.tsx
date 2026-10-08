import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { Badge, Card } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/dal";
import { learningService } from "@/lib/server/container";

const REASON_TEXT: Record<string, string> = {
  review_due: "Includes a review that's due, so it sticks.",
  weak_skill: "Revisits a skill your recent submissions found hard, using a quest you've already passed.",
  continue_campaign: "Continues your campaign where you left off.",
  continues_later: "The quest is longer than this session — your project is saved, so you can stop any time and pick it up later.",
};

export default async function SessionPage({ params }: PageProps<"/sessions/[id]">) {
  const { id } = await params;
  const user = await requirePageUser(`/sessions/${id}`);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const session = await learningService().getSession(user.userId, id);
  if (session === undefined) notFound();

  return (
    <>
      <AppHeader email={user.email} />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your {session.budgetMinutes}-minute session</h1>
          <p className="text-neutral-600 dark:text-neutral-400">Planned by CodeQuest&apos;s rules — here&apos;s why.</p>
        </div>
        {session.state === "completed" && (
          <div role="status" className="rounded-xl border border-emerald-600/40 bg-emerald-50 p-5 text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-100">
            <p className="font-medium">🎉 Session complete. Nice work.</p>
            <p className="mt-1 text-sm">
              Everything planned is done. <Link href="/" className="underline">Start another session</Link> or check your{" "}
              <Link href="/progress" className="underline">progress</Link>.
            </p>
          </div>
        )}
        {session.reasonCodes.length > 0 && (
          <Card>
            <h2 className="mb-2 font-semibold">Why this plan</h2>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {session.reasonCodes.map((code) => (
                <li key={code}>{REASON_TEXT[code] ?? code}</li>
              ))}
            </ul>
          </Card>
        )}
        {session.items.length === 0 ? (
          <Card>
            <p>Nothing to plan right now — you&apos;re all caught up.</p>
          </Card>
        ) : (
          <ol className="flex flex-col gap-3">
            {session.items.map((item, index) => (
              <li key={item.id}>
                <Card className="flex flex-wrap items-center gap-3">
                  <span className="text-sm text-neutral-500 dark:text-neutral-400">{index + 1}.</span>
                  <span className="font-medium">{item.title}</span>
                  <Badge>≈ {item.estimatedMinutes} min</Badge>
                  {item.state === "completed" && <Badge tone="success">✓ Done</Badge>}
                  {item.state === "in_progress" && <Badge tone="warning">In progress</Badge>}
                  <Link
                    href={`/quests/${item.contentVersionId}?session=${session.id}&item=${item.id}`}
                    className="ml-auto rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
                  >
                    {item.state === "completed" ? "Open" : item.state === "in_progress" ? "Continue" : "Start"}
                  </Link>
                </Card>
              </li>
            ))}
          </ol>
        )}
      </main>
    </>
  );
}
