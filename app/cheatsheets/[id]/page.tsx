import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { Markdown } from "@/components/markdown";
import { Card, UnreviewedBadge } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/dal";
import { cheatsheetService } from "@/lib/server/container";
import { ApiError } from "@/lib/server/http";

export const metadata: Metadata = { title: "Cheat sheet · CodeQuest" };

export default async function CheatsheetPage({ params }: PageProps<"/cheatsheets/[id]">) {
  const { id } = await params;
  const user = await requirePageUser(`/cheatsheets/${id}`);
  let view;
  try {
    view = await cheatsheetService().get(user.userId, id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  return (
    <>
      <AppHeader email={user.email} />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
        {"hidden" in view ? (
          <Card>
            <p>Cheat sheets are hidden while your mock interview runs.</p>
          </Card>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{view.sheet.title}</h1>
              <UnreviewedBadge status={view.sheet.review.status} />
            </div>
            <Markdown>{view.sheet.body}</Markdown>
            <footer className="border-t border-neutral-200 pt-3 text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
              <p>
                Version {view.sheet.version}, updated {view.sheet.updated}. Sources: {view.sheet.sources.join("; ")}.
              </p>
              <p className="mt-1">
                <Link href="/cheatsheets" className="underline">
                  All cheat sheets
                </Link>
              </p>
            </footer>
          </>
        )}
      </main>
    </>
  );
}
