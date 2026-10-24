import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { Card, UnreviewedBadge } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/dal";
import { cheatsheetService } from "@/lib/server/container";

export const metadata: Metadata = { title: "Cheat sheets · CodeQuest" };

export default async function CheatsheetsPage() {
  const user = await requirePageUser("/cheatsheets");
  const access = await cheatsheetService().list(user.userId);

  return (
    <>
      <AppHeader email={user.email} />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
        <h1 className="text-2xl font-semibold tracking-tight">Cheat sheets</h1>
        {access.hidden ? (
          <Card>
            <p>Cheat sheets are hidden while your mock interview runs, as they would be in a real interview.</p>
            <p className="mt-2">
              <Link href="/mock" className="text-indigo-700 underline dark:text-indigo-300">
                Back to the mock
              </Link>
            </p>
          </Card>
        ) : access.sheets.length === 0 ? (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">No reviewed cheat sheets yet. Turn on unreviewed drafts on the home page to see drafts.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {access.sheets.map((sheet) => (
              <li key={sheet.id}>
                <Card>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/cheatsheets/${sheet.id}`} className="font-medium hover:underline">
                      {sheet.title}
                    </Link>
                    <UnreviewedBadge status={sheet.review.status} />
                  </div>
                  <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">{sheet.summary}</p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
