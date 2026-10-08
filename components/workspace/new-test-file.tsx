"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { useWorkspace } from "@/lib/workspace/store";
import { newTestFile, suggestTestClassName } from "@/lib/workspace/test-file";

/** "+ Test file": adds a JUnit 5 test class next to the code it tests (spec §12, §19). */
export function NewTestFile() {
  const { activePath, order, addFile } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>();

  function start() {
    setName(suggestTestClassName(activePath));
    setError(undefined);
    setOpen(true);
  }

  function create() {
    const fallbackMain = order.find((path) => path.startsWith("src/main/java/"));
    const file = newTestFile(name, activePath, order, fallbackMain);
    if (!file.ok) {
      setError(file.message);
      return;
    }
    addFile(file.path, file.source);
    setOpen(false);
  }

  if (!open) {
    return (
      <button type="button" onClick={start} className="whitespace-nowrap px-3 py-2 text-sm text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/40">
        ＋ Test file
      </button>
    );
  }

  return (
    <form
      className="flex w-full flex-wrap items-center gap-2 border-t border-neutral-200 p-2 text-sm dark:border-neutral-800"
      onSubmit={(event) => {
        event.preventDefault();
        create();
      }}
    >
      <label htmlFor="new-test-name">Test class name</label>
      <input
        id="new-test-name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        autoFocus
        aria-invalid={error !== undefined}
        aria-describedby={error ? "new-test-error" : undefined}
        className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 font-mono outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-700"
      />
      <Button type="submit" variant="primary">
        Create
      </Button>
      <Button onClick={() => setOpen(false)}>Cancel</Button>
      {error && (
        <p id="new-test-error" role="alert" className="w-full text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </form>
  );
}
