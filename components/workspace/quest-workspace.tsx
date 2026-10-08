"use client";

import { useCallback, useEffect, useState } from "react";
import { Markdown } from "@/components/markdown";
import { Badge, Button, UnreviewedBadge } from "@/components/ui";
import { apiCall, ClientApiError } from "@/lib/client/api";
import { useActiveSeconds } from "@/lib/client/use-active-seconds";
import { useWorkspace, type FileStatus } from "@/lib/workspace/store";
import { useProjectSync } from "@/lib/workspace/use-project-sync";
import { CodeEditor } from "./code-editor";
import { ResultsPanel, type ExecutionView, type SubmissionExtras } from "./results-panel";

export interface QuestView {
  readonly contentVersionId: string;
  readonly title: string;
  readonly summary: string;
  readonly status: string;
  readonly stage: string;
  readonly estimatedMinutes: number;
  readonly instructions: string;
  readonly hintsUsed: number;
  readonly hintsAvailable: number;
  readonly usedHints: ReadonlyArray<{ tier: number; label: string; text: string }>;
  readonly sampleCount: number;
}

interface Props {
  readonly quest: QuestView;
  readonly starter: ReadonlyArray<{ path: string; content: string }>;
  readonly project: { projectId: string; files: ReadonlyArray<{ path: string; revision: number; source: string }> };
  readonly sessionItemId?: string;
}

const STATUS_TEXT: Record<FileStatus, string> = {
  saved: "Saved",
  dirty: "Unsaved",
  saving: "Saving…",
  offline: "Offline — kept on this device",
  conflict: "Conflict",
};

const STAGE_TEXT: Record<string, string> = {
  worked_example: "Worked example",
  completion: "Completion",
  guided: "Guided",
  independent: "Independent",
  change_request: "Change request",
  delayed_transfer: "Transfer",
};

/** Instructions open with "# <title>"; the page already shows the title as its heading. */
function withoutRepeatedTitle(markdown: string, title: string): string {
  const heading = `# ${title}`;
  return markdown.startsWith(heading) ? markdown.slice(heading.length).trimStart() : markdown;
}

const lastJobKey = (contentVersionId: string) => `codequest:last-job:${contentVersionId}`;
const fileLabel = (path: string) => path.split("/").pop() ?? path;

type ExecuteResponse = { jobId: string; result: ExecutionView } & SubmissionExtras;

/** Keeps project sync running once the store holds this project's files. */
function ProjectSync() {
  useProjectSync();
  return null;
}

export function QuestWorkspace({ quest, starter, project, sessionItemId }: Props) {
  // Ready once the shared store holds this project (init happens in an effect below).
  const ready = useWorkspace((state) => state.projectId === project.projectId);
  const files = useWorkspace((state) => state.files);
  const order = useWorkspace((state) => state.order);
  const activePath = useWorkspace((state) => state.activePath);
  const { setActive, edit, keepLocal, acceptSaved } = useWorkspace.getState();
  const active = files[activePath];

  const [fontSize, setFontSize] = useState(14);
  const [running, setRunning] = useState<"run" | "submit" | undefined>();
  const [result, setResult] = useState<ExecutionView | undefined>();
  const [extras, setExtras] = useState<SubmissionExtras | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [hints, setHints] = useState(quest.usedHints);
  const [hintError, setHintError] = useState<string | undefined>();
  const [confirmReset, setConfirmReset] = useState(false);
  const activeTime = useActiveSeconds();

  useEffect(() => {
    useWorkspace.getState().init(project.projectId, project.files);
  }, [project]);

  // A reload mid-run, or after one, shows that run's result again (spec §67).
  useEffect(() => {
    const jobId = sessionStorage.getItem(lastJobKey(quest.contentVersionId));
    if (!jobId) return;
    apiCall<{ result: ExecutionView | null }>(`/api/v1/executions/${jobId}`)
      .then((job) => job.result && setResult(job.result))
      .catch(() => sessionStorage.removeItem(lastJobKey(quest.contentVersionId)));
  }, [quest.contentVersionId]);

  const execute = useCallback(
    async (mode: "run" | "submit") => {
      if (running) return;
      const jobId = crypto.randomUUID();
      sessionStorage.setItem(lastJobKey(quest.contentVersionId), jobId);
      setRunning(mode);
      setError(undefined);
      setExtras(undefined);
      try {
        const response = await apiCall<ExecuteResponse>("/api/v1/executions", {
          method: "POST",
          timeoutMs: 120_000,
          body: {
            jobId,
            contentVersionId: quest.contentVersionId,
            mode,
            files: Object.values(useWorkspace.getState().files).map((file) => ({ path: file.path, content: file.source })),
            sessionItemId,
            activeSeconds: mode === "submit" ? activeTime.take() : 0,
          },
        });
        setResult(response.result);
        if (mode === "submit") setExtras({ awardedXp: response.awardedXp, skills: response.skills });
      } catch (caught) {
        setError(caught instanceof ClientApiError ? caught.message : "Couldn't run your code.");
      } finally {
        setRunning(undefined);
      }
    },
    [running, quest.contentVersionId, sessionItemId, activeTime],
  );

  async function nextHint() {
    setHintError(undefined);
    try {
      const hint = await apiCall<{ tier: number; label: string; text: string }>(`/api/v1/quests/${quest.contentVersionId}/hints`, { method: "POST" });
      setHints((current) => (current.some((existing) => existing.tier === hint.tier) ? current : [...current, hint]));
    } catch (caught) {
      setHintError(caught instanceof ClientApiError ? caught.message : "Couldn't load a hint.");
    }
  }

  function resetActiveFile() {
    const original = starter.find((file) => file.path === activePath);
    if (original) edit(activePath, original.content);
    setConfirmReset(false);
  }

  const canReset = starter.some((file) => file.path === activePath);

  return (
    <main className="mx-auto grid w-full max-w-[1400px] flex-1 gap-4 px-4 py-4 lg:grid-cols-[minmax(320px,2fr)_3fr]">
      {ready && <ProjectSync />}
      <section aria-labelledby="quest-title" className="flex flex-col gap-4 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 id="quest-title" className="text-xl font-semibold tracking-tight">
            {quest.title}
          </h1>
          <UnreviewedBadge status={quest.status} />
          <Badge>{STAGE_TEXT[quest.stage] ?? quest.stage}</Badge>
          <Badge>≈ {quest.estimatedMinutes} min</Badge>
        </div>
        <p className="lg:hidden text-sm text-neutral-600 dark:text-neutral-400">Coding is easiest on a larger screen; everything you type is saved as you go.</p>
        <Markdown>{withoutRepeatedTitle(quest.instructions, quest.title)}</Markdown>

        <section aria-labelledby="hints-title" className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <h2 id="hints-title" className="font-semibold">
            Hints
          </h2>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            Hints never cost XP. A success after a hint counts as assisted, and you can come back later to solve it on your own.
          </p>
          <ol className="mt-3 space-y-2 text-sm">
            {hints.map((hint) => (
              <li key={hint.tier} className="rounded-md bg-neutral-50 p-2 dark:bg-neutral-800/60">
                <span className="font-medium capitalize">{hint.label.replace("_", " ")}:</span> {hint.text}
              </li>
            ))}
          </ol>
          {hints.length < quest.hintsAvailable && (
            <Button className="mt-3" onClick={() => void nextHint()}>
              {hints.length === 0 ? "Show a hint" : "Show the next hint"}
            </Button>
          )}
          {hintError && (
            <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
              {hintError}
            </p>
          )}
        </section>
      </section>

      <section aria-label="Code" className="flex min-h-[70vh] flex-col overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
        <div role="tablist" aria-label="Files" className="flex overflow-x-auto border-b border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
          {order.map((path) => {
            const file = files[path];
            return (
              <button
                key={path}
                role="tab"
                type="button"
                aria-selected={path === activePath}
                title={path}
                onClick={() => setActive(path)}
                className={`whitespace-nowrap border-r border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800 ${path === activePath ? "bg-white font-medium dark:bg-neutral-950" : "text-neutral-600 dark:text-neutral-400"}`}
              >
                {fileLabel(path)}
                {file && file.status !== "saved" && <span className="ml-1" aria-label={STATUS_TEXT[file.status]}>{file.status === "conflict" ? "⚠" : "•"}</span>}
              </button>
            );
          })}
        </div>

        {active?.status === "conflict" && active.conflict && (
          <div role="alert" className="border-b border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
            <p className="font-medium">⚠ {fileLabel(active.path)} was changed somewhere else (another tab or device).</p>
            <p>Your version is still here. Choose which to keep — nothing is overwritten until you do.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => keepLocal(active.path)}>
                Keep my version
              </Button>
              <Button onClick={() => acceptSaved(active.path)}>Use the saved version</Button>
            </div>
            <details className="mt-2">
              <summary className="cursor-pointer">Show the saved version</summary>
              <pre className="mt-1 max-h-48 overflow-auto rounded bg-white p-2 font-mono text-xs dark:bg-neutral-900">{active.conflict.serverSource}</pre>
            </details>
          </div>
        )}

        <div className="min-h-[360px] flex-1">
          {ready && active ? (
            <CodeEditor
              path={active.path}
              value={active.source}
              fontSize={fontSize}
              onChange={(value) => edit(active.path, value)}
              onRun={() => void execute("run")}
              onSubmit={() => void execute("submit")}
            />
          ) : (
            <p className="p-4 text-sm text-neutral-500">Loading your project…</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-neutral-200 p-2 dark:border-neutral-800">
          <Button variant="secondary" onClick={() => void execute("run")} disabled={running !== undefined || quest.sampleCount === 0} title="Ctrl/⌘ + Enter">
            {running === "run" ? "Running…" : "Run samples"}
          </Button>
          <Button variant="primary" onClick={() => void execute("submit")} disabled={running !== undefined} title="Ctrl/⌘ + Shift + Enter">
            {running === "submit" ? "Checking…" : "Submit"}
          </Button>
          <span className="text-xs text-neutral-500" aria-live="polite">
            {active ? `${fileLabel(active.path)}: ${STATUS_TEXT[active.status]}` : ""}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" aria-label="Smaller text" onClick={() => setFontSize((size) => Math.max(11, size - 1))}>
              A−
            </Button>
            <Button variant="ghost" aria-label="Larger text" onClick={() => setFontSize((size) => Math.min(22, size + 1))}>
              A+
            </Button>
            {canReset && (
              <Button variant="ghost" onClick={() => setConfirmReset(true)}>
                Reset file
              </Button>
            )}
          </div>
        </div>

        {confirmReset && (
          <div role="alertdialog" aria-labelledby="reset-title" className="border-t border-red-200 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950/40">
            <p id="reset-title" className="font-medium">
              Replace {fileLabel(activePath)} with the quest&apos;s starter version?
            </p>
            <p>Your current edits to this file will be replaced. Earlier submissions keep their own copies.</p>
            <div className="mt-2 flex gap-2">
              <Button variant="danger" onClick={resetActiveFile}>
                Replace with starter
              </Button>
              <Button onClick={() => setConfirmReset(false)}>Cancel</Button>
            </div>
          </div>
        )}

        <div className="max-h-[40vh] overflow-y-auto border-t border-neutral-200 p-3 dark:border-neutral-800" aria-live="polite">
          {running && <p className="text-sm text-neutral-600 dark:text-neutral-400">{running === "run" ? "Compiling and running the samples…" : "Compiling and running every check…"}</p>}
          {!running && error && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              {error}
            </p>
          )}
          {!running && result && <ResultsPanel result={result} extras={extras} />}
          {!running && !result && !error && <p className="text-sm text-neutral-500">Run the samples to check your progress, then Submit when you&apos;re ready.</p>}
        </div>
      </section>
    </main>
  );
}
