"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";
import { apiCall, ClientApiError } from "@/lib/client/api";

const EMPTY = { title: "Untitled story", competencies: [], situation: "", task: "", action: "", result: "", learned: "" };

export function NewStory() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function create() {
    setBusy(true);
    setError(undefined);
    try {
      const { story } = await apiCall<{ story: { id: string } }>("/api/v1/stories", { method: "POST", body: EMPTY });
      router.push(`/stories/${story.id}`);
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "Couldn't add a story.");
      setBusy(false);
    }
  }

  return (
    <div>
      <Button variant="primary" disabled={busy} onClick={() => void create()}>
        {busy ? "Adding…" : "Add a story"}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
