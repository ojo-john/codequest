import Link from "next/link";
import { signOut } from "@/app/auth/actions";

export function AppHeader({ email, wide = false, query = "" }: { email: string | undefined; wide?: boolean; query?: string }) {
  return (
    <header className="border-b border-neutral-200 bg-white/80 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/80">
      <nav aria-label="Main" className={`mx-auto flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 ${wide ? "max-w-[1400px]" : "max-w-6xl"}`}>
        <Link href="/" className="font-semibold tracking-tight">
          CodeQuest
        </Link>
        <Link href="/" className="text-sm text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white">
          Home
        </Link>
        <Link href="/practice" className="text-sm text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white">
          Practice
        </Link>
        <Link href="/skills" className="text-sm text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white">
          Skills
        </Link>
        <Link href="/mock" className="text-sm text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white">
          Mock
        </Link>
        <Link href="/stories" className="text-sm text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white">
          Stories
        </Link>
        <Link href="/cheatsheets" className="text-sm text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white">
          Cheat sheets
        </Link>
        <Link href="/progress" className="text-sm text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white">
          Progress
        </Link>
        <Link href="/data" className="text-sm text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white">
          Your data
        </Link>
        <Link href="/usage" className="text-sm text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white">
          Usage
        </Link>
        <form action="/search" role="search" className="ml-auto">
          <label htmlFor="site-search" className="sr-only">
            Search
          </label>
          <input
            id="site-search"
            name="q"
            type="search"
            defaultValue={query}
            placeholder="Search"
            maxLength={100}
            className="w-36 rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-700"
          />
        </form>
        <span className="hidden text-sm text-neutral-500 dark:text-neutral-400 sm:inline" data-testid="signed-in-email">
          {email}
        </span>
        <form action={signOut}>
          <button type="submit" className="text-sm text-neutral-600 underline underline-offset-4 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white">
            Sign out
          </button>
        </form>
      </nav>
    </header>
  );
}
