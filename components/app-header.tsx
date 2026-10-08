import Link from "next/link";
import { signOut } from "@/app/auth/actions";

export function AppHeader({ email, wide = false }: { email: string | undefined; wide?: boolean }) {
  return (
    <header className="border-b border-neutral-200 bg-white/80 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/80">
      <nav aria-label="Main" className={`mx-auto flex items-center gap-6 px-4 py-3 ${wide ? "max-w-[1400px]" : "max-w-6xl"}`}>
        <Link href="/" className="font-semibold tracking-tight">
          CodeQuest
        </Link>
        <Link href="/" className="text-sm text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white">
          Home
        </Link>
        <Link href="/progress" className="text-sm text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white">
          Progress
        </Link>
        <Link href="/data" className="text-sm text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white">
          Your data
        </Link>
        <span className="ml-auto hidden text-sm text-neutral-500 sm:inline" data-testid="signed-in-email">
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
