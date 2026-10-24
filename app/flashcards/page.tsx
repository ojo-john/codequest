import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import { FlashcardReview } from "@/components/flashcards/flashcard-review";
import { requirePageUser } from "@/lib/auth/dal";
import { flashcardService } from "@/lib/server/container";

export const metadata: Metadata = { title: "Flashcards · CodeQuest" };

export default async function FlashcardsPage() {
  const user = await requirePageUser("/flashcards");
  const { due, all } = await flashcardService().overview(user.userId);

  return (
    <>
      <AppHeader email={user.email} />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
        <h1 className="text-2xl font-semibold tracking-tight">Flashcards</h1>
        <p className="text-sm text-neutral-700 dark:text-neutral-300">
          Cards you made from your own notes, in your own words. CodeQuest doesn&apos;t check them, so treat them as your notes, not as verified facts. A card you knew
          comes back later each time (1, 2, 4, 8, then 16 days); one you didn&apos;t comes back tomorrow.
        </p>
        <FlashcardReview due={due} all={all} />
      </main>
    </>
  );
}
