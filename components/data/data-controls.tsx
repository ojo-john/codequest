"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui";
import { apiCall, ClientApiError } from "@/lib/client/api";
import { clearAllDrafts } from "@/lib/offline/drafts";

type SignatureCheck = "valid" | "missing" | "unknown_key" | "invalid";

interface ImportResult {
  readonly signature: SignatureCheck;
  readonly progressRestored: boolean;
  readonly report: Readonly<Record<string, { readonly imported: number; readonly skipped: number }>>;
}

const UPLOAD_TIMEOUT_MS = 60_000;

const PROGRESS_NOT_RESTORED: Record<Exclude<SignatureCheck, "valid">, string> = {
  missing: "This archive isn't signed, so only your projects and notes were restored — not XP or skill estimates.",
  invalid: "This archive was changed after it was downloaded, so only your projects and notes were restored — not XP or skill estimates.",
  unknown_key: "This archive was signed by a different CodeQuest (or before its key changed), so only your projects and notes were restored.",
};

/** [singular, plural] for each table the learner would recognise. */
const TABLE_LABELS: Record<string, readonly [string, string]> = {
  projects: ["project", "projects"],
  project_files: ["project file", "project files"],
  project_checkpoints: ["checkpoint", "checkpoints"],
  notes: ["note", "notes"],
  sessions: ["session", "sessions"],
  attempts: ["attempt", "attempts"],
  mastery_evidence: ["piece of skill evidence", "pieces of skill evidence"],
  skill_states: ["skill estimate", "skill estimates"],
  xp_events: ["XP award", "XP awards"],
  hint_requests: ["hint", "hints"],
};

/** gzip in the browser when supported: archives then fit comfortably under the upload limit. */
async function compress(file: File): Promise<{ bytes: Blob; contentType: string }> {
  if (typeof CompressionStream === "undefined") return { bytes: file, contentType: "application/json" };
  const stream = file.stream().pipeThrough(new CompressionStream("gzip"));
  return { bytes: await new Response(stream).blob(), contentType: "application/gzip" };
}

function describeError(error: unknown): string {
  if (!(error instanceof ClientApiError)) return "Something went wrong. Please try again.";
  return error.requestId ? `${error.message} (reference ${error.requestId.slice(0, 8)})` : error.message;
}

export function ImportArchiveForm() {
  const router = useRouter();
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (file === null) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const upload = await compress(file);
      setResult(await apiCall<ImportResult>("/api/v1/archive", { method: "POST", upload, timeoutMs: UPLOAD_TIMEOUT_MS }));
      router.refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  const restored = result
    ? Object.entries(result.report)
        .filter(([table, counts]) => counts.imported > 0 && TABLE_LABELS[table] !== undefined)
        .map(([table, counts]) => `${counts.imported} ${TABLE_LABELS[table][counts.imported === 1 ? 0 : 1]}`)
    : [];

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <label htmlFor={inputId} className="text-sm font-medium">
        Archive file
      </label>
      <input
        id={inputId}
        type="file"
        accept="application/json,.json"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        className="text-sm file:mr-3 file:rounded-md file:border file:border-neutral-300 file:bg-white file:px-3 file:py-1.5 file:text-sm dark:file:border-neutral-700 dark:file:bg-neutral-900 dark:file:text-neutral-100"
      />
      <div>
        <Button type="submit" variant="primary" disabled={file === null || busy}>
          {busy ? "Restoring…" : "Restore"}
        </Button>
      </div>
      <div aria-live="polite" className="text-sm">
        {result && (
          <div data-testid="import-result" className="flex flex-col gap-1">
            <p className="font-medium">
              {restored.length === 0 ? "Nothing new to restore — you already have everything in this archive." : `Restored ${restored.join(", ")}.`}
            </p>
            {result.signature !== "valid" && <p className="text-amber-800 dark:text-amber-300">{PROGRESS_NOT_RESTORED[result.signature]}</p>}
          </div>
        )}
        {error && (
          <p role="alert" className="text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}

export function DeleteDataForm({ phrase }: { phrase: string }) {
  const router = useRouter();
  const inputId = useId();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: "done" | "error"; text: string } | null>(null);
  const confirmed = typed.trim().toLowerCase() === phrase;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!confirmed) return;
    setBusy(true);
    setStatus(null);
    try {
      await apiCall("/api/v1/data", { method: "DELETE", body: { confirm: typed } });
      const localCleared = await clearAllDrafts();
      setTyped("");
      setStatus({
        tone: "done",
        text: localCleared ? "Your progress and projects were erased, including drafts saved in this browser." : "Your progress and projects were erased. This browser's local drafts couldn't be cleared — clear site data to remove them.",
      });
      router.refresh();
    } catch (caught) {
      setStatus({ tone: "error", text: describeError(caught) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <label htmlFor={inputId} className="text-sm">
        Type <strong className="font-mono">{phrase}</strong> to confirm
      </label>
      <input
        id={inputId}
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        autoComplete="off"
        className="max-w-sm rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950"
      />
      <div>
        <Button type="submit" variant="danger" disabled={!confirmed || busy}>
          {busy ? "Erasing…" : "Erase everything"}
        </Button>
      </div>
      <div aria-live="polite" className="text-sm">
        {status && (
          <p role={status.tone === "error" ? "alert" : undefined} className={status.tone === "error" ? "text-red-700 dark:text-red-300" : "font-medium"}>
            {status.text}
          </p>
        )}
      </div>
    </form>
  );
}
