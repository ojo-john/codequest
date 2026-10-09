import "server-only";
import { z } from "zod";
import { gradeAnswer, InvalidResponseError, type CorrectAnswer, type ExerciseOutcome } from "@/lib/exercises/grade";
import { DIAGNOSTIC_WORLD, placementSummary, type SectionResult } from "@/lib/exercises/diagnostic";
import type { PublicQuestion } from "@/lib/exercises/schema";
import { DIAGNOSTIC_EVIDENCE_WEIGHT, MASTERY_MODEL_VERSION, masteryState, SCHEDULER_VERSION, updateSkillState, type SkillState } from "@/lib/learning/mastery";
import { XP } from "@/lib/learning/xp";
import type { ExerciseSetRecord, ExerciseStore } from "./exercise-store";
import { ApiError } from "./http";
import type { LearningStore } from "./learning-store";

/**
 * Exercise sets (spec §43, §46): short questions graded deterministically on the server. Each
 * answer is one attempt with one evidence row for the question's skill dimension; the first
 * correct answer to a question earns a little XP (keyed, so never twice).
 */

export const answerExerciseSchema = z.object({
  /** Client-generated; repeating it returns the original result without recording again. */
  requestKey: z.string().min(8).max(100),
  contentVersionId: z.uuid(),
  questionId: z.string().min(1).max(60),
  answer: z.unknown(),
  activeSeconds: z.number().int().min(0).max(3600).default(0),
});

export interface ExerciseServiceDeps {
  readonly store: ExerciseStore;
  readonly skills: Pick<LearningStore, "skillStates">;
  readonly clock?: () => Date;
}

export interface ExerciseSetSummary {
  readonly contentVersionId: string;
  readonly title: string;
  readonly summary: string;
  readonly world: { readonly id: string; readonly order: number };
  readonly estimatedMinutes: number;
  readonly status: string;
  readonly questionCount: number;
}

export interface AnswerResult {
  readonly outcome: ExerciseOutcome;
  readonly correct: CorrectAnswer;
  readonly why: string;
  readonly awardedXp: number;
  readonly skill: { readonly state: string; readonly reviewInDays: number } | null;
}

const OUTCOME_TEXT: Record<ExerciseOutcome, string> = { pass: "succeeded", partial: "partial", fail: "wrong-answer" };
const OUTCOME_FROM_TEXT: Record<string, ExerciseOutcome> = { succeeded: "pass", partial: "partial", "wrong-answer": "fail" };

export interface PlacementView {
  readonly diagnostic: { readonly contentVersionId: string; readonly title: string; readonly estimatedMinutes: number };
  /** Whether any diagnostic question has been answered. */
  readonly taken: boolean;
  readonly sections: ReadonlyArray<SectionResult & { readonly startWith?: { readonly contentVersionId: string; readonly title: string } }>;
}

export class ExerciseService {
  private readonly store: ExerciseStore;
  private readonly skills: ExerciseServiceDeps["skills"];
  private readonly clock: () => Date;

  constructor(deps: ExerciseServiceDeps) {
    this.store = deps.store;
    this.skills = deps.skills;
    this.clock = deps.clock ?? (() => new Date());
  }

  async listSets(userId: string): Promise<ExerciseSetSummary[]> {
    const sets = await this.store.listVisibleSets(userId);
    return sets
      // The diagnostic runs adaptively from Base Camp, not as a practice set.
      .filter((set) => set.world.id !== DIAGNOSTIC_WORLD)
      .map((set) => ({
        contentVersionId: set.contentVersionId,
        title: set.title,
        summary: set.summary,
        world: set.world,
        estimatedMinutes: set.estimatedMinutes,
        status: set.status,
        questionCount: set.questions.length,
      }))
      .sort((a, b) => a.world.id.localeCompare(b.world.id) || a.world.order - b.world.order);
  }

  /** The set's questions (no answers) and the learner's best outcome so far per question. */
  async getSet(userId: string, contentVersionId: string): Promise<{ set: ExerciseSetRecord; best: Record<string, string> }> {
    const set = await this.requireSet(userId, contentVersionId);
    return { set, best: Object.fromEntries(await this.store.bestOutcomes(userId, contentVersionId)) };
  }

  async answer(userId: string, request: z.infer<typeof answerExerciseSchema>): Promise<AnswerResult> {
    const set = await this.requireSet(userId, request.contentVersionId);
    const question: PublicQuestion | undefined = set.questions.find((candidate) => candidate.id === request.questionId);
    if (question === undefined) throw new ApiError(404, "not_found", "That question isn't part of this set.");
    const answers = await this.store.getAnswers(request.contentVersionId);
    const key = answers[question.id];
    // The content gate guarantees every question has an answer; a gap is our bug, not the learner's.
    if (key === undefined) throw new Error(`exercise ${set.contentId} question ${question.id} has no answer`);

    let graded;
    try {
      graded = gradeAnswer(question, key, request.answer);
    } catch (error) {
      if (error instanceof InvalidResponseError) throw new ApiError(400, "invalid_answer", error.message);
      throw error;
    }

    const now = this.clock();
    // The diagnostic places you; it isn't practice: half-weight evidence and no XP (spec §3).
    const diagnostic = set.world.id === DIAGNOSTIC_WORLD;
    const evidence = { skillId: key.skill, dimension: key.dimension, outcome: graded.outcome, independence: "independent" as const, modelVersion: MASTERY_MODEL_VERSION };
    const previous = (await this.skills.skillStates(userId)).find((state: SkillState) => state.skillId === key.skill && state.dimension === key.dimension);
    const update = updateSkillState(previous, evidence, now, diagnostic ? DIAGNOSTIC_EVIDENCE_WEIGHT : 1);
    const recorded = await this.store.recordAttempt({
      userId,
      contentVersionId: request.contentVersionId,
      requestKey: request.requestKey,
      response: { questionId: question.id, answer: request.answer },
      activeSeconds: request.activeSeconds,
      outcome: OUTCOME_TEXT[graded.outcome],
      evidence: [{ skill_id: key.skill, dimension: key.dimension, outcome: graded.outcome, independence: "independent", model_version: MASTERY_MODEL_VERSION }],
      skillStates: [
        {
          skill_id: update.skillId,
          dimension: update.dimension,
          estimate: update.estimate,
          evidence_count: update.evidenceCount,
          review_due_at: update.reviewDueAt.toISOString(),
          scheduler_version: SCHEDULER_VERSION,
          model_version: MASTERY_MODEL_VERSION,
        },
      ],
      xp: graded.outcome === "pass" && !diagnostic ? [{ event_key: `exercise:${set.contentId}:${question.id}`, delta: XP.exercise }] : [],
    });

    return {
      outcome: graded.outcome,
      correct: graded.correct,
      why: key.why,
      awardedXp: recorded.awardedXp,
      // A replay recorded nothing new, so there is no fresh skill update to report.
      skill: recorded.replayed ? null : { state: masteryState(update, now), reviewInDays: update.intervalDays },
    };
  }

  /**
   * The Base Camp diagnostic and the learner's placement from it (best answer per question so
   * far). Undefined when no diagnostic is visible to this learner.
   */
  async placement(userId: string): Promise<PlacementView | undefined> {
    const sets = await this.store.listVisibleSets(userId);
    const diagnostic = sets.find((set) => set.world.id === DIAGNOSTIC_WORLD && set.sections !== undefined);
    if (diagnostic === undefined || diagnostic.sections === undefined) return undefined;
    const best = await this.store.bestOutcomes(userId, diagnostic.contentVersionId);
    const outcomes = new Map([...best].flatMap(([id, outcome]) => (OUTCOME_FROM_TEXT[outcome] ? [[id, OUTCOME_FROM_TEXT[outcome]] as const] : [])));
    const startingPoints = new Map(
      diagnostic.sections.map((section) => {
        const first = sets.filter((set) => set.world.id === section.world).sort((a, b) => a.world.order - b.world.order)[0];
        return [section.id, first ? { contentVersionId: first.contentVersionId, title: first.title } : undefined] as const;
      }),
    );
    return {
      diagnostic: { contentVersionId: diagnostic.contentVersionId, title: diagnostic.title, estimatedMinutes: diagnostic.estimatedMinutes },
      taken: outcomes.size > 0,
      sections: placementSummary(diagnostic.sections, outcomes).map((result) => ({ ...result, startWith: startingPoints.get(result.sectionId) })),
    };
  }

  private async requireSet(userId: string, contentVersionId: string): Promise<ExerciseSetRecord> {
    const set = await this.store.getVisibleSet(userId, contentVersionId);
    if (set === undefined) throw new ApiError(404, "not_found", "That exercise set doesn't exist or isn't available to you.");
    return set;
  }
}
