"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { apiCall, ClientApiError } from "@/lib/client/api";

/** Wait this long after the last keystroke before saving. */
const SAVE_DELAY_MS = 1000;

type Status = "idle" | "saving" | "saved" | "error";

/** The learner's own notes on a quest (spec §51). Saved as typed; never checked or corrected. */
export function NotesPanel({ contentVersionId, initialBody }: { contentVersionId: string; initialBody: string }) {
  const [body, setBody] = useState(initialBody);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | undefined>();
  const saved = useRef(initialBody);
  const [card, setCard] = useState<{ front: string; back: string } | undefined>();
  const [cardState, setCardState] = useState<"idle" | "saving" | "saved">("idle");
  const [cardError, setCardError] = useState<string | undefined>();

  async function saveCard() {
    if (!card) return;
    setCardState("saving");
    setCardError(undefined);
    try {
      await apiCall("/api/v1/flashcards", { method: "POST", body: { contentVersionId, front: card.front, back: card.back } });
      setCard(undefined);
      setCardState("saved");
    } catch (caught) {
      setCardError(caught instanceof ClientApiError ? caught.message : "Couldn't make the flashcard.");
      setCardState("idle");
    }
  }

  useEffect(() => {
    if (body === saved.current) return;
    const timer = setTimeout(() => {
      setStatus("saving");
      apiCall(`/api/v1/quests/${contentVersionId}/note`, { method: "PUT", body: { body } })
        .then(() => {
          saved.current = body;
          setStatus("saved");
          setMessage(undefined);
        })
        .catch((caught: unknown) => {
          setStatus("error");
          setMessage(caught instanceof ClientApiError ? caught.message : "Couldn't save your note. It's still here; keep typing to retry.");
        });
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [body, contentVersionId]);

  return (
    <section aria-labelledby="notes-title" className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="flex items-center justify-between gap-2">
        <h2 id="notes-title" className="font-semibold">
          Your notes
        </h2>
        <span className="text-xs text-neutral-500 dark:text-neutral-400" aria-live="polite">
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : ""}
        </span>
      </div>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">In your own words. CodeQuest keeps them exactly as written and doesn&apos;t check them.</p>
      <label htmlFor="quest-notes" className="sr-only">
        Notes on this quest
      </label>
      <textarea
        id="quest-notes"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        maxLength={20_000}
        rows={4}
        className="mt-2 w-full rounded-md border border-neutral-300 bg-transparent p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-700"
      />
      {status === "error" && message && (
        <p role="alert" className="mt-1 text-sm text-red-700 dark:text-red-400">
          {message}
        </p>
      )}
      {card ? (
        <form
          className="mt-3 flex flex-col gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-800"
          onSubmit={(event) => {
            event.preventDefault();
            void saveCard();
          }}
        >
          <label htmlFor="card-front" className="text-sm font-medium">
            Flashcard question
          </label>
          <input
            id="card-front"
            maxLength={500}
            value={card.front}
            onChange={(event) => setCard({ ...card, front: event.target.value })}
            className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-700"
          />
          <label htmlFor="card-back" className="text-sm font-medium">
            Answer (your words; edit freely)
          </label>
          <textarea
            id="card-back"
            maxLength={2000}
            rows={3}
            value={card.back}
            onChange={(event) => setCard({ ...card, back: event.target.value })}
            className="rounded-md border border-neutral-300 bg-transparent p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-700"
          />
          <div className="flex gap-2">
            <button type="submit" disabled={cardState === "saving" || card.front.trim() === "" || card.back.trim() === ""} className="rounded-md bg-indigo-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50">
              {cardState === "saving" ? "Saving…" : "Save flashcard"}
            </button>
            <button type="button" onClick={() => setCard(undefined)} className="rounded-md border border-neutral-300 px-3 py-1 text-sm dark:border-neutral-700">
              Cancel
            </button>
          </div>
          {cardError && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              {cardError}
            </p>
          )}
        </form>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <button
            type="button"
            disabled={body.trim() === ""}
            onClick={() => {
              setCardState("idle");
              setCard({ front: "", back: body.trim().slice(0, 2000) });
            }}
            className="rounded-md border border-neutral-300 px-3 py-1 disabled:opacity-50 dark:border-neutral-700"
          >
            Make a flashcard
          </button>
          {cardState === "saved" && (
            <span role="status">
              Flashcard saved.{" "}
              <Link href="/flashcards" className="text-indigo-700 underline dark:text-indigo-300">
                Review your cards
              </Link>
            </span>
          )}
        </div>
      )}
    </section>
  );
}
