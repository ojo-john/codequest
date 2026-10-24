import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCheatsheets } from "@/lib/server/cheatsheet-repository";
import { score, snippet, terms } from "@/lib/search/search";

describe("search matching", () => {
  it("terms_lowercasesAndDeduplicates", () => {
    expect(terms("  BFS bfs  Graph ")).toEqual(["bfs", "graph"]);
  });

  it("score_everyTermMustAppear", () => {
    expect(score({ title: "Graphs", text: "BFS and DFS" }, ["bfs", "heap"])).toBeNull();
  });

  it("score_titleMatchesOutrankBodyMatches", () => {
    expect(score({ title: "BFS", text: "" }, ["bfs"])! > score({ title: "Graphs", text: "uses BFS" }, ["bfs"])!).toBe(true);
  });

  it("score_noTerms_matchesNothing", () => {
    expect(score({ title: "Anything", text: "at all" }, [])).toBeNull();
  });

  it("snippet_centresOnTheMatchAndStripsMarkdown", () => {
    const text = `${"filler ".repeat(30)}## **BFS** checklist\n| mark visited | when enqueued |`;

    expect(snippet(text, ["bfs"])).toMatch(/^….*BFS checklist mark visited/);
  });

  it("snippet_noMatch_returnsTheStart", () => {
    expect(snippet("Short text here.", ["zzz"])).toBe("Short text here.");
  });
});

describe("loadCheatsheets", () => {
  function directory(index: unknown, files: Record<string, string> = {}): string {
    const dir = mkdtempSync(join(tmpdir(), "sheets-"));
    writeFileSync(join(dir, "index.json"), JSON.stringify(index));
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
    return dir;
  }
  const sheet = (id: string) => ({ id, title: "Title", summary: "A summary long enough.", file: `${id}.md`, version: 1, updated: "2026-10-24", review: { status: "draft" }, sources: ["A real source"] });
  const provenance = { author: "Claude", license: "All rights reserved" };

  it("loadCheatsheets_repositoryContent_hasTheNineSpecTopics", () => {
    expect(loadCheatsheets().map((s) => s.id)).toEqual(["java", "big-o", "data-structures", "patterns", "graphs", "dynamic-programming", "system-design", "sql", "concurrency"]);
  });

  it("loadCheatsheets_duplicateIds_areRejected", () => {
    expect(() => loadCheatsheets(directory({ version: 1, provenance, sheets: [sheet("a"), sheet("a")] }, { "a.md": "x" }))).toThrow(/repeat/);
  });

  it("loadCheatsheets_missingFile_throws", () => {
    expect(() => loadCheatsheets(directory({ version: 1, provenance, sheets: [sheet("gone")] }))).toThrow(/ENOENT/);
  });

  it("loadCheatsheets_sheetWithoutSources_isRejected", () => {
    expect(() => loadCheatsheets(directory({ version: 1, provenance, sheets: [{ ...sheet("a"), sources: [] }] }, { "a.md": "x" }))).toThrow();
  });
});
