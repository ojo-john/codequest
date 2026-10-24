import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { Badge } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/dal";
import { MAX_QUERY_LENGTH, MIN_QUERY_LENGTH } from "@/lib/search/search";
import { searchService } from "@/lib/server/container";
import type { SearchKind } from "@/lib/server/search-service";

export const metadata: Metadata = { title: "Search · CodeQuest" };

const KIND: Record<SearchKind, string> = { skill: "Skill", problem: "Problem", practice: "Practice", cheatsheet: "Cheat sheet", note: "Your note", story: "Your story" };

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const user = await requirePageUser("/search");
  const raw = (await searchParams).q;
  const query = (typeof raw === "string" ? raw : "").trim().slice(0, MAX_QUERY_LENGTH);
  const searched = query.length >= MIN_QUERY_LENGTH ? await searchService().search(user.userId, query) : undefined;

  return (
    <>
      <AppHeader email={user.email} query={query} />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
        <h1 className="text-2xl font-semibold tracking-tight">{query ? `Results for “${query}”` : "Search"}</h1>
        {!searched ? (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">Type at least {MIN_QUERY_LENGTH} characters: a topic like BFS, a skill, a problem, or something from your notes.</p>
        ) : (
          <>
            {searched.studyAidsHidden && <p className="text-sm text-amber-800 dark:text-amber-300">Cheat sheets and notes are left out while your mock interview runs.</p>}
            {searched.results.length === 0 ? (
              <p className="text-sm text-neutral-600 dark:text-neutral-400">Nothing matches every word. Try fewer or different words.</p>
            ) : (
              <ul className="flex flex-col gap-3" data-testid="search-results">
                {searched.results.map((result) => (
                  <li key={`${result.kind}:${result.href}:${result.title}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>{KIND[result.kind]}</Badge>
                      <Link href={result.href} className="font-medium hover:underline">
                        {result.title}
                      </Link>
                    </div>
                    <p className="mt-0.5 text-sm text-neutral-700 dark:text-neutral-300">{result.snippet}</p>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>
    </>
  );
}
