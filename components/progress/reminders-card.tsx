"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card } from "@/components/ui";
import { apiCall, ClientApiError } from "@/lib/client/api";
import type { NotificationPrefs } from "@/lib/engagement/notifications";

const field = "rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-700";

const LEVELS: ReadonlyArray<{ id: NotificationPrefs["level"]; label: string; hint: string }> = [
  { id: "off", label: "Off", hint: "No reminders." },
  { id: "gentle", label: "Gentle", hint: "Only when reviews or flashcards are ready." },
  { id: "normal", label: "Normal", hint: "Also a friendly nudge on days you haven't practised yet." },
];

export function RemindersCard({ initial, dueCards }: { initial: NotificationPrefs; dueCards: number }) {
  const router = useRouter();
  const [prefs, setPrefs] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | undefined>();

  async function save(next: NotificationPrefs) {
    setState("saving");
    setError(undefined);
    try {
      await apiCall("/api/v1/engagement/notifications", { method: "PUT", body: next });
      setPrefs(next);
      setState("saved");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "Couldn't save your reminder settings.");
      setState("idle");
    }
  }

  return (
    <Card>
      <h2 className="font-semibold">Reminders</h2>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        Shown on your home page, in your time zone, never during quiet hours and never to make you feel bad. Email reminders aren&apos;t set up.
      </p>
      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save(prefs);
        }}
      >
        <fieldset>
          <legend className="text-sm font-medium">How often</legend>
          <div className="mt-1 flex flex-col gap-1">
            {LEVELS.map((level) => (
              <label key={level.id} className="flex items-start gap-2 text-sm">
                <input type="radio" name="level" className="mt-1" checked={prefs.level === level.id} onChange={() => setPrefs({ ...prefs, level: level.id })} />
                <span>
                  <span className="font-medium">{level.label}</span> — {level.hint}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={prefs.consent} onChange={(event) => setPrefs({ ...prefs, consent: event.target.checked })} />
          <span>I&apos;d like CodeQuest to remind me. (You can turn this off any time.)</span>
        </label>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col">
            Quiet from
            <input type="time" value={prefs.quietStart} onChange={(event) => setPrefs({ ...prefs, quietStart: event.target.value })} className={field} />
          </label>
          <label className="flex flex-col">
            until
            <input type="time" value={prefs.quietEnd} onChange={(event) => setPrefs({ ...prefs, quietEnd: event.target.value })} className={field} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={state === "saving"}>
            {state === "saving" ? "Saving…" : "Save reminders"}
          </Button>
          {prefs.level !== "off" && (
            <Button variant="ghost" disabled={state === "saving"} onClick={() => void save({ ...prefs, level: "off", consent: false })}>
              Turn reminders off
            </Button>
          )}
          <span className="text-sm text-neutral-600 dark:text-neutral-400" aria-live="polite">
            {state === "saved" ? "Saved." : ""}
          </span>
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {error}
          </p>
        )}
      </form>
      <p className="mt-3 text-sm">
        <Link href="/flashcards" className="text-indigo-700 underline dark:text-indigo-300">
          Your flashcards
        </Link>{" "}
        ({dueCards} due)
      </p>
    </Card>
  );
}
