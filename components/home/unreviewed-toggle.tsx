"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiCall, ClientApiError } from "@/lib/client/api";

/** Explicit opt-in to unreviewed content (spec §44): it's always labelled wherever it appears. */
export function UnreviewedToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  // Optimistic: reflect the click at once, revert if saving fails.
  const [checked, setChecked] = useState(enabled);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function change(next: boolean) {
    setChecked(next);
    setPending(true);
    setError(undefined);
    try {
      await apiCall("/api/v1/preferences", { method: "PATCH", body: { showUnreviewedContent: next } });
      router.refresh();
    } catch (caught) {
      setChecked(!next);
      setError(caught instanceof ClientApiError ? caught.message : "Couldn't save the setting.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={checked}
          disabled={pending}
          onChange={(event) => void change(event.target.checked)}
          className="mt-0.5 size-4 accent-indigo-600"
        />
        <span>
          <span className="font-medium">Show unreviewed drafts</span>
          <span className="block text-neutral-600 dark:text-neutral-400">
            Content written by AI that no human has reviewed yet. It may contain mistakes and is labelled wherever it appears.
          </span>
        </span>
      </label>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
