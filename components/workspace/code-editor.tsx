"use client";

import Editor, { loader, type OnMount } from "@monaco-editor/react";
import { useEffect, useRef, useSyncExternalStore } from "react";

// Monaco loads from our own origin (copied by scripts/copy-monaco.ts) — no CDN at runtime.
loader.config({ paths: { vs: "/monaco/vs" } });

export interface CodeEditorProps {
  readonly path: string;
  readonly value: string;
  readonly fontSize: number;
  readonly onChange: (value: string) => void;
  readonly onRun: () => void;
  readonly onSubmit: () => void;
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeToColorScheme(onChange: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Multi-file Java editor: one Monaco model per path, so undo history stays with each file. */
export function CodeEditor({ path, value, fontSize, onChange, onRun, onSubmit }: CodeEditorProps) {
  const dark = useSyncExternalStore(subscribeToColorScheme, () => window.matchMedia(DARK_QUERY).matches, () => false);
  // Keyboard shortcuts are registered once on mount; this ref always points at the latest handlers.
  const actions = useRef({ onRun, onSubmit });
  useEffect(() => {
    actions.current = { onRun, onSubmit };
  }, [onRun, onSubmit]);

  const handleMount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => actions.current.onRun());
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => actions.current.onSubmit());
  };

  return (
    <Editor
      path={path}
      defaultLanguage="java"
      value={value}
      theme={dark ? "vs-dark" : "light"}
      onChange={(next) => onChange(next ?? "")}
      onMount={handleMount}
      loading={<p className="p-4 text-sm text-neutral-500 dark:text-neutral-400">Loading editor…</p>}
      options={{
        fontSize,
        minimap: { enabled: false },
        tabSize: 4,
        insertSpaces: true,
        scrollBeyondLastLine: false,
        automaticLayout: true,
        wordWrap: "off",
        // Basic, local completion only: no AI assistance in the editor (spec §12).
        quickSuggestions: { other: true, comments: false, strings: false },
        accessibilitySupport: "auto",
        ariaLabel: `Code editor: ${path}`,
      }}
    />
  );
}
