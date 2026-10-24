"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, Card } from "@/components/ui";
import { apiCall, ClientApiError } from "@/lib/client/api";
import type { FlashcardView } from "@/lib/server/flashcard-service";

export function FlashcardReview({ due, all }: { due: readonly FlashcardView[]; all: readonly FlashcardView[] }) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [confirm, setConfirm] = useState<string | undefined>();
  const card = due[index];

  async function answer(knewIt: boolean) {
    if (!card) return;
    setBusy(true);
    setError(undefined);
    try {
      await apiCall(`/api/v1/flashcards/${card.id}/review`, { method: "POST", body: { knewIt } });
      setRevealed(false);
      setIndex((current) => current + 1);
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "Couldn't record that answer.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await apiCall(`/api/v1/flashcards/${id}`, { method: "DELETE" });
      setConfirm(undefined);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "Couldn't delete the card.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h2 className="font-semibold">Review</h2>
        {card ? (
          <div className="mt-2 flex flex-col gap-3">
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              Card {index + 1} of {due.length}
              {card.context && (
                <>
                  {" "}
                  · from{" "}
                  <Link href={card.context.href} className="text-indigo-700 underline dark:text-indigo-300">
                    {card.context.title}
                  </Link>
                </>
              )}
            </p>
            <p className="text-lg font-medium" data-testid="card-front">
              {card.front}
            </p>
            {revealed ? (
              <>
                <p className="whitespace-pre-wrap rounded-md bg-neutral-50 p-3 dark:bg-neutral-800/60" data-testid="card-back">
                  {card.back}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" disabled={busy} onClick={() => void answer(true)}>
                    I knew it
                  </Button>
                  <Button disabled={busy} onClick={() => void answer(false)}>
                    Not yet
                  </Button>
                </div>
              </>
            ) : (
              <Button className="self-start" onClick={() => setRevealed(true)}>
                Show answer
              </Button>
            )}
          </div>
        ) : (
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400" data-testid="no-cards-due">
            {due.length === 0 ? "Nothing due right now." : "That's all the cards due. Nice work."}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
            {error}
          </p>
        )}
      </Card>
      <Card>
        <h2 className="font-semibold">All your cards</h2>
        {all.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">No cards yet. Make one from your notes on any problem.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {all.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{entry.front}</span>
                <Badge>Box {entry.box}</Badge>
                {confirm === entry.id ? (
                  <span role="alertdialog" aria-label="Confirm delete" className="flex items-center gap-2">
                    Delete this card?
                    <Button variant="danger" onClick={() => void remove(entry.id)}>
                      Delete
                    </Button>
                    <Button onClick={() => setConfirm(undefined)}>Keep</Button>
                  </span>
                ) : (
                  <Button variant="ghost" onClick={() => setConfirm(entry.id)}>
                    Delete
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
