import { describe, expect, it } from "vitest";
import type { Cheatsheet } from "@/lib/cheatsheets/cheatsheets";
import { CheatsheetService } from "@/lib/server/cheatsheet-service";
import type { ExerciseSetRecord } from "@/lib/server/exercise-store";
import { ApiError } from "@/lib/server/http";
import type { ContentStatus, QuestRecord } from "@/lib/server/learning-store";
import { SearchService } from "@/lib/server/search-service";

const USER = "11111111-1111-4111-8111-111111111111";

const SHEET = (id: string, status: "draft" | "published", body = "BFS marks vertices when enqueued.") =>
  ({ id, title: id.toUpperCase(), summary: "A summary long enough.", file: `${id}.md`, version: 1, updated: "2026-10-24", review: { status }, sources: ["Source"], body }) as Cheatsheet;

function cheatsheets(options: { running?: boolean; statuses?: readonly ContentStatus[] } = {}) {
  return new CheatsheetService({
    sheets: () => [SHEET("graphs", "draft"), SHEET("sql", "published", "Joins and groups.")],
    visibleStatuses: async () => options.statuses ?? ["published", "draft"],
    mocks: { isRunning: async () => options.running ?? false },
  });
}

const QUEST = { contentVersionId: "cv-bfs", contentId: "memory.bfs-distances", title: "From memory: BFS", summary: "Write BFS.", instructions: "Distances from a start vertex." } as unknown as QuestRecord;
const SET = { contentVersionId: "cv-set", contentId: "set.graphs", title: "Graph practice", summary: "Traversals.", questions: [{ id: "q", type: "single_choice", prompt: "Secretword appears only in a question", options: ["a", "b"] }] } as unknown as ExerciseSetRecord;

function search(options: { running?: boolean; notes?: Array<{ contentId: string; body: string }> } = {}) {
  return new SearchService({
    quests: { listVisibleQuests: async () => [QUEST] },
    sets: { listVisibleSets: async () => [SET] },
    skills: { skills: async () => [{ id: "patterns.graph-search", name: "Graph search", category: "patterns", definition: "BFS and DFS over graphs.", difficulty: 3, worldId: null }] },
    cheatsheets: cheatsheets({ running: options.running }),
    notes: { notes: async () => options.notes ?? [{ contentId: "memory.bfs-distances", body: "Remember: BFS marks on enqueue." }] },
    stories: { list: async () => [] },
    mocks: { isRunning: async () => options.running ?? false },
  });
}

describe("CheatsheetService", () => {
  it("list_duringAMock_isHidden", async () => {
    expect(await cheatsheets({ running: true }).list(USER)).toEqual({ hidden: "mock_in_progress" });
  });

  it("list_withoutTheDraftsOptIn_showsOnlyPublished", async () => {
    const access = await cheatsheets({ statuses: ["published"] }).list(USER);

    expect(access.hidden ? [] : access.sheets.map((sheet) => sheet.id)).toEqual(["sql"]);
  });

  it("get_hiddenDraft_is404", async () => {
    const error = await cheatsheets({ statuses: ["published"] }).get(USER, "graphs").catch((caught: unknown) => caught);

    expect(error instanceof ApiError && error.status).toBe(404);
  });
});

describe("SearchService", () => {
  it("search_findsEveryKindThatMentionsTheTerm", async () => {
    const { results } = await search().search(USER, "BFS");

    expect(results.map((result) => result.kind).sort()).toEqual(["cheatsheet", "note", "problem", "skill"]);
  });

  it("search_duringAMock_leavesOutCheatSheetsAndNotes", async () => {
    const found = await search({ running: true }).search(USER, "BFS");

    expect([found.studyAidsHidden, found.results.map((result) => result.kind).sort()]).toEqual([true, ["problem", "skill"]]);
  });

  it("search_neverSearchesPracticeQuestions", async () => {
    expect((await search().search(USER, "secretword")).results).toEqual([]);
  });

  it("search_noteOnContentNoLongerVisible_isLeftOut", async () => {
    const { results } = await search({ notes: [{ contentId: "cart.q1-checkout-totals", body: "BFS somewhere" }] }).search(USER, "BFS");

    expect(results.some((result) => result.kind === "note")).toBe(false);
  });

  it("search_tooShortQuery_isRejected", async () => {
    await expect(search().search(USER, "b")).rejects.toThrow();
  });

  it("search_noteResult_linksToItsProblem", async () => {
    const { results } = await search().search(USER, "enqueue");

    expect(results.find((result) => result.kind === "note")).toMatchObject({ title: "Your note on From memory: BFS", href: "/quests/cv-bfs" });
  });
});
