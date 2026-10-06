import { signOut } from "@/app/auth/actions";
import { requirePageUser } from "@/lib/auth/dal";

export default async function HomePage() {
  const user = await requirePageUser("/");
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-12">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">CodeQuest</h1>
        <form action={signOut}>
          <button type="submit" className="text-sm text-neutral-600 underline underline-offset-4 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100">
            Sign out
          </button>
        </form>
      </header>
      <p className="text-neutral-700 dark:text-neutral-300">
        Signed in as <span data-testid="signed-in-email" className="font-mono">{user.email}</span>.
      </p>
      <p className="text-sm text-neutral-500">The coding campaign arrives in the next Phase 1 steps.</p>
    </main>
  );
}
