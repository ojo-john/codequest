"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui";
import { apiCall, ClientApiError } from "@/lib/client/api";
import type { BossView } from "@/lib/server/exercise-service";

/** A mastery exam's outcome (spec §53): each section judged on its own, with what to practise. */
export function BossResult({ contentVersionId, since }: { contentVersionId: string; since: string }) {
  const [view, setView] = useState<BossView | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    apiCall<BossView>(`/api/v1/exercises/${contentVersionId}/boss-result?since=${encodeURIComponent(since)}`)
      .then(setView)
      .catch((caught: unknown) => setError(caught instanceof ClientApiError ? caught.message : "Couldn't load your exam result."));
  }, [contentVersionId, since]);

  if (error)
    return (
      <p role="alert" className="text-sm text-red-700 dark:text-red-400">
        {error}
      </p>
    );
  if (!view) return <p className="text-sm text-neutral-600 dark:text-neutral-400">Working out your result…</p>;
  return (
    <div className="flex flex-col gap-3 text-sm" role="status">
      <p className="text-base font-semibold">{view.passed ? "🏆 Exam passed" : "Not passed yet"}</p>
      <p className="text-neutral-600 dark:text-neutral-400">Each section needs {Math.round(view.passShare * 100)}% on its own. Perfection isn&apos;t required.</p>
      <ul className="flex flex-col gap-2">
        {view.sections.map((section) => (
          <li key={section.sectionId}>
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{section.name}</span>
              <Badge tone={section.passed ? "success" : "warning"}>{section.passed ? "Passed" : "Not yet"}</Badge>
              <span className="text-neutral-600 dark:text-neutral-400">
                {Math.round(section.share * 100)}% ({section.answered} of {section.total} answered)
              </span>
            </p>
            {section.remediation.length > 0 && (
              <p className="text-neutral-600 dark:text-neutral-400">
                Practise:{" "}
                {section.remediation.map((set, index) => (
                  <span key={set.contentVersionId}>
                    {index > 0 && ", "}
                    <Link href={`/practice/${set.contentVersionId}`} className="font-medium text-indigo-700 underline dark:text-indigo-300">
                      {set.title}
                    </Link>
                  </span>
                ))}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
