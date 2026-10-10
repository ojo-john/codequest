"use client";

import { useEffect, useState } from "react";
import { ExerciseRunner, type RunnerItem } from "@/components/exercises/exercise-runner";
import { Markdown } from "@/components/markdown";
import { Badge, Button, Card } from "@/components/ui";
import { apiCall, ClientApiError } from "@/lib/client/api";
import { designPath } from "@/lib/exercises/design";
import type { DesignBrief } from "@/lib/exercises/schema";
import { useWorkspace, type FileStatus } from "@/lib/workspace/store";
import { useProjectSync } from "@/lib/workspace/use-project-sync";

/**
 * The design workspace (spec §29, §59): a text-first design, one document per section, saved and
 * synced like code; then the interviewer's follow-up probes; then a self-review checklist.
 */

const STATUS: Record<FileStatus, string> = { saved: "Saved", dirty: "Unsaved", saving: "Saving…", offline: "Offline — kept on this device", conflict: "Changed elsewhere" };

function ProjectSync() {
  useProjectSync();
  return null;
}

/** Elapsed time against the suggested limit; informational only, nothing is cut off. */
function Timer({ limitMinutes }: { limitMinutes: number }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  const minutes = Math.floor(seconds / 60);
  const over = minutes >= limitMinutes;
  return (
    <span className={over ? "font-medium text-amber-700 dark:text-amber-300" : ""}>
      {minutes}:{String(seconds % 60).padStart(2, "0")} of {limitMinutes}:00{over ? " — time's up in an interview; finish your thought" : ""}
    </span>
  );
}

function Review({ contentVersionId, since }: { contentVersionId: string; since: string }) {
  const [considerations, setConsiderations] = useState<string[] | undefined>();
  const [error, setError] = useState<string | undefined>();
  useEffect(() => {
    apiCall<{ considerations: string[] }>(`/api/v1/exercises/${contentVersionId}/design-review?since=${encodeURIComponent(since)}`)
      .then((response) => setConsiderations(response.considerations))
      .catch((caught: unknown) => setError(caught instanceof ClientApiError ? caught.message : "Couldn't load the review."));
  }, [contentVersionId, since]);
  if (error)
    return (
      <p role="alert" className="text-sm text-red-700 dark:text-red-400">
        {error}
      </p>
    );
  if (!considerations) return <p className="text-sm text-neutral-600 dark:text-neutral-400">Loading the review…</p>;
  return (
    <section aria-labelledby="review-title">
      <h2 id="review-title" className="font-semibold">
        Self-review
      </h2>
      <p className="mb-2 text-sm text-neutral-600 dark:text-neutral-400">
        Points a strong answer usually covers. Tick the ones your design addressed; this is for you, not graded. Several designs can be valid.
      </p>
      <ul className="flex flex-col gap-1 text-sm">
        {considerations.map((point) => (
          <li key={point}>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" />
              <span>{point}</span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function DesignWorkspace({
  title,
  design,
  project,
  probes,
  contentVersionId,
  sittingStartedAt,
}: {
  title: string;
  design: DesignBrief;
  project: { readonly projectId: string; readonly files: ReadonlyArray<{ path: string; revision: number; source: string }> };
  probes: readonly RunnerItem[];
  contentVersionId: string;
  sittingStartedAt: string;
}) {
  const ready = useWorkspace((state) => state.projectId === project.projectId);
  const files = useWorkspace((state) => state.files);
  const [stage, setStage] = useState<"writing" | "probes" | "review">("writing");

  useEffect(() => {
    useWorkspace.getState().init(project.projectId, project.files);
  }, [project]);

  return (
    <main className="mx-auto grid w-full max-w-[1400px] flex-1 gap-4 px-4 py-4 lg:grid-cols-[minmax(320px,2fr)_3fr]">
      {ready && <ProjectSync />}
      <section aria-labelledby="design-title" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 id="design-title" className="text-xl font-semibold tracking-tight">
            {title}
          </h1>
          <Badge>Design challenge</Badge>
        </div>
        <p className="text-sm text-neutral-600 dark:text-neutral-400" aria-live="off">
          <Timer limitMinutes={design.timeMinutes} />
        </p>
        <Markdown>{design.scenario}</Markdown>
        <Card>
          <h2 className="mb-1 font-semibold">Requirements</h2>
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {design.requirements.map((requirement) => (
              <li key={requirement}>{requirement}</li>
            ))}
          </ul>
        </Card>
      </section>

      <section aria-label="Your design" className="flex flex-col gap-4">
        {stage === "writing" && (
          <>
            {design.sections.map((section) => {
              const path = designPath(section.id);
              const file = files[path];
              return (
                <div key={section.id}>
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor={`design-${section.id}`} className="font-medium">
                      {section.title}
                    </label>
                    <span className="text-xs text-neutral-500 dark:text-neutral-400" aria-live="polite">
                      {file ? STATUS[file.status] : ""}
                    </span>
                  </div>
                  <p id={`design-${section.id}-hint`} className="text-sm text-neutral-600 dark:text-neutral-400">
                    {section.guidance}
                  </p>
                  <textarea
                    id={`design-${section.id}`}
                    aria-describedby={`design-${section.id}-hint`}
                    rows={6}
                    disabled={!ready || !file}
                    value={file?.source ?? ""}
                    onChange={(event) => useWorkspace.getState().edit(path, event.target.value)}
                    className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent p-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-700"
                  />
                </div>
              );
            })}
            <Button variant="primary" className="self-start" onClick={() => setStage("probes")}>
              I&apos;m done: answer the follow-up questions
            </Button>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">Your design stays saved; you can come back to it any time.</p>
          </>
        )}
        {stage === "probes" && (
          <Card>
            <h2 className="mb-2 font-semibold">The interviewer follows up</h2>
            <ExerciseRunner items={probes} title={title} onFinished={() => setStage("review")} />
          </Card>
        )}
        {stage === "review" && (
          <Card>
            <Review contentVersionId={contentVersionId} since={sittingStartedAt} />
          </Card>
        )}
      </section>
    </main>
  );
}
