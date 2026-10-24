import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { MAX_QUERY_LENGTH, MIN_QUERY_LENGTH, score, snippet, terms, type SearchDocument } from "@/lib/search/search";
import type { CheatsheetService } from "./cheatsheet-service";
import type { ExerciseStore } from "./exercise-store";
import type { LearningStore } from "./learning-store";
import { StoreError } from "./learning-store";
import type { SkillTreeStore } from "./skill-tree-store";
import type { StoryStore } from "./story-store";

/**
 * Global search (spec §50) over skills, problems, practice sets, cheat sheets and the learner's
 * own notes and stories. Only public text is searched: never answers, hidden tests or grading.
 * Personal results are the learner's alone. During a mock, cheat sheets and notes are left out.
 */

export const searchQuerySchema = z.string().trim().min(MIN_QUERY_LENGTH).max(MAX_QUERY_LENGTH);

export type SearchKind = "skill" | "problem" | "practice" | "cheatsheet" | "note" | "story";

export interface SearchResult {
  readonly kind: SearchKind;
  readonly title: string;
  readonly href: string;
  readonly snippet: string;
}

const PER_KIND = 10;

/** The learner's own notes, scoped by user (server key). */
export interface NoteSearchStore {
  notes(userId: string): Promise<Array<{ contentId: string; body: string }>>;
}

const MAX_NOTES = 500;

export class SupabaseNoteSearchStore implements NoteSearchStore {
  constructor(private readonly db: SupabaseClient) {}

  async notes(userId: string) {
    const result = await this.db.from("notes").select("content_id, body").eq("user_id", userId).order("updated_at", { ascending: false }).limit(MAX_NOTES);
    if (result.error) throw new StoreError("search_notes", result.error.message, { cause: result.error });
    return (result.data as Array<{ content_id: string; body: string }>).map((row) => ({ contentId: row.content_id, body: row.body }));
  }
}

export interface SearchServiceDeps {
  readonly quests: Pick<LearningStore, "listVisibleQuests">;
  readonly sets: Pick<ExerciseStore, "listVisibleSets">;
  readonly skills: Pick<SkillTreeStore, "skills">;
  readonly cheatsheets: Pick<CheatsheetService, "list">;
  readonly notes: NoteSearchStore;
  readonly stories: Pick<StoryStore, "list">;
  readonly mocks: { isRunning(userId: string): Promise<boolean> };
}

interface Candidate extends SearchDocument {
  readonly kind: SearchKind;
  readonly href: string;
}

export class SearchService {
  constructor(private readonly deps: SearchServiceDeps) {}

  async search(userId: string, query: string): Promise<{ results: SearchResult[]; studyAidsHidden: boolean }> {
    const queryTerms = terms(searchQuerySchema.parse(query));
    const mock = await this.deps.mocks.isRunning(userId);
    const [quests, sets, skills, sheets, notes, stories] = await Promise.all([
      this.deps.quests.listVisibleQuests(userId),
      this.deps.sets.listVisibleSets(userId),
      this.deps.skills.skills(),
      mock ? Promise.resolve({ hidden: "mock_in_progress" as const }) : this.deps.cheatsheets.list(userId),
      mock ? Promise.resolve([]) : this.deps.notes.notes(userId),
      this.deps.stories.list(userId),
    ]);
    const titles = new Map<string, { title: string; href: string }>([
      ...quests.map((quest) => [quest.contentId, { title: quest.title, href: `/quests/${quest.contentVersionId}` }] as const),
      ...sets.map((set) => [set.contentId, { title: set.title, href: set.design ? `/design/${set.contentVersionId}` : `/practice/${set.contentVersionId}` }] as const),
    ]);

    const candidates: Candidate[] = [
      ...skills.map((skill) => ({ kind: "skill" as const, title: skill.name, text: skill.definition, href: `/skills/${encodeURIComponent(skill.id)}` })),
      ...quests.map((quest) => ({ kind: "problem" as const, title: quest.title, text: `${quest.summary}\n${quest.instructions}`, href: `/quests/${quest.contentVersionId}` })),
      // Practice sets: titles and summaries only; questions stay unseen until practised.
      ...sets.map((set) => ({ kind: "practice" as const, title: set.title, text: set.summary, href: titles.get(set.contentId)?.href ?? "/practice" })),
      ...(sheets.hidden ? [] : sheets.sheets.map((sheet) => ({ kind: "cheatsheet" as const, title: sheet.title, text: `${sheet.summary}\n${sheet.body}`, href: `/cheatsheets/${sheet.id}` }))),
      ...notes.flatMap((note) => {
        const owner = titles.get(note.contentId);
        return owner ? [{ kind: "note" as const, title: `Your note on ${owner.title}`, text: note.body, href: owner.href }] : [];
      }),
      ...stories.map((story) => ({ kind: "story" as const, title: story.title, text: [story.situation, story.task, story.action, story.result, story.learned].join("\n"), href: `/stories/${story.id}` })),
    ];

    const results = candidates
      .flatMap((candidate) => {
        const value = score(candidate, queryTerms);
        return value === null ? [] : [{ candidate, value }];
      })
      .sort((a, b) => b.value - a.value || a.candidate.title.localeCompare(b.candidate.title));
    const perKind = new Map<SearchKind, number>();
    const limited = results.filter(({ candidate }) => {
      const count = perKind.get(candidate.kind) ?? 0;
      perKind.set(candidate.kind, count + 1);
      return count < PER_KIND;
    });
    return {
      results: limited.map(({ candidate }) => ({ kind: candidate.kind, title: candidate.title, href: candidate.href, snippet: snippet(candidate.text, queryTerms) })),
      studyAidsHidden: mock,
    };
  }
}
