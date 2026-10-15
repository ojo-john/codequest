"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";
import { apiCall, ClientApiError } from "@/lib/client/api";
import { MOCK_DURATIONS } from "@/lib/interview/mock-scoring";

export function StartMock() {
  const router = useRouter();
  const [starting, setStarting] = useState<number | undefined>();
  const [error, setError] = useState<string | undefined>();

  async function start(durationMinutes: number) {
    setStarting(durationMinutes);
    setError(undefined);
    try {
      const mock = await apiCall<{ id: string }>("/api/v1/mocks", { method: "POST", body: { durationMinutes, requestKey: crypto.randomUUID() } });
      router.push(`/mock/${mock.id}`);
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "Couldn't start the mock interview.");
      setStarting(undefined);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {MOCK_DURATIONS.map((minutes) => (
          <Button key={minutes} variant={minutes === 45 ? "primary" : "secondary"} disabled={starting !== undefined} onClick={() => void start(minutes)}>
            {starting === minutes ? "Starting…" : `Start a ${minutes}-minute coding mock`}
          </Button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
