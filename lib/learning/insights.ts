/**
 * Learning insights (spec §61): transparent rules over the learner's recent graded submissions
 * that name a recurring pattern and suggest one concrete next step. Every insight carries its
 * sample size and time window; a pattern is only reported once there's enough evidence, and a
 * small sample is labelled as an early signal. Insights describe what happened in the work —
 * never diagnoses, personality or ability.
 */

export const INSIGHTS_VERSION = "insights-v1";
export const INSIGHT_WINDOW_DAYS = 30;
/** Look at no more than this many of the most recent submissions. */
export const INSIGHT_MAX_SUBMISSIONS = 20;
/** Fewer relevant submissions than this: say nothing. */
export const INSIGHT_MIN_SAMPLE = 3;
/** Below this many, an insight is labelled an early signal. */
export const INSIGHT_CONFIDENT_SAMPLE = 6;
const MIN_MATCHES = 2;
const MIN_SHARE = 0.4;

export interface SubmissionSummary {
  readonly attemptId: string;
  readonly contentVersionId: string;
  readonly contentId: string;
  readonly createdAt: Date;
  readonly outcome: string;
  readonly hintLevel: number;
  readonly passedCaseIds: readonly string[];
  readonly failedCaseIds: readonly string[];
  /** The quest's edge-case checks (empty when it tags none). */
  readonly edgeCaseIds: readonly string[];
  readonly skills: readonly string[];
}

export interface QuestRef {
  readonly contentVersionId: string;
  readonly contentId: string;
  readonly title: string;
  readonly order: number;
  readonly completed: boolean;
  readonly skills: readonly string[];
  /** Grades the learner's own tests. */
  readonly gradesTests: boolean;
}

export type InsightCode = "edge_cases_missed" | "hint_reliance" | "compile_errors" | "struggling_skill";

export interface Insight {
  readonly code: InsightCode;
  readonly message: string;
  /** How many relevant submissions the rule looked at, and how many showed the pattern. */
  readonly sampleSize: number;
  readonly matching: number;
  readonly windowDays: number;
  readonly earlySignal: boolean;
  /** The attempts that showed the pattern. */
  readonly evidence: readonly string[];
  /** For struggling_skill: the skill. */
  readonly skillId?: string;
  readonly recommendation?: { readonly contentVersionId: string; readonly title: string; readonly why: string };
}

const GRADED_OUTCOMES = new Set(["succeeded", "wrong-answer", "compile-error", "runtime-error", "timeout"]);

function reportable(matching: number, sample: number): boolean {
  return sample >= INSIGHT_MIN_SAMPLE && matching >= MIN_MATCHES && matching / sample >= MIN_SHARE;
}

/** "line-rejects-zero-quantity" -> "line rejects zero quantity" */
function readableCase(id: string): string {
  return id.replaceAll("-", " ");
}

function insight(code: InsightCode, matching: SubmissionSummary[], sample: number, message: string, extra: Partial<Insight> = {}): Insight {
  return {
    code,
    message,
    sampleSize: sample,
    matching: matching.length,
    windowDays: INSIGHT_WINDOW_DAYS,
    earlySignal: sample < INSIGHT_CONFIDENT_SAMPLE,
    evidence: matching.map((submission) => submission.attemptId),
    ...extra,
  };
}

export function deriveInsights(
  submissions: readonly SubmissionSummary[],
  quests: readonly QuestRef[],
  skillNames: ReadonlyMap<string, string>,
  now: Date,
): Insight[] {
  const since = now.getTime() - INSIGHT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const recent = [...submissions]
    .filter((submission) => submission.createdAt.getTime() >= since && GRADED_OUTCOMES.has(submission.outcome))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, INSIGHT_MAX_SUBMISSIONS);
  const byOrder = [...quests].sort((a, b) => a.order - b.order);
  const insights: Insight[] = [];

  // 1. Boundaries: the main checks pass but an edge case fails.
  const withEdges = recent.filter((submission) => submission.edgeCaseIds.length > 0 && submission.outcome !== "compile-error");
  const edgeMisses = withEdges.filter((submission) => {
    const edges = new Set(submission.edgeCaseIds);
    const missedEdge = submission.failedCaseIds.some((id) => edges.has(id));
    const mainPassed = submission.passedCaseIds.some((id) => !edges.has(id));
    return missedEdge && mainPassed;
  });
  if (reportable(edgeMisses.length, withEdges.length)) {
    const example = edgeMisses[0].failedCaseIds.find((id) => edgeMisses[0].edgeCaseIds.includes(id)) ?? "";
    const practice = byOrder.find((quest) => quest.gradesTests && !quest.completed) ?? byOrder.find((quest) => quest.gradesTests);
    insights.push(
      insight(
        "edge_cases_missed",
        edgeMisses,
        withEdges.length,
        `On ${edgeMisses.length} of your last ${withEdges.length} submissions with edge-case checks, the main checks passed but an edge case failed (for example "${readableCase(example)}"). Before submitting, list the boundaries — empty, one item, exactly at a limit, just past it — and check each one.`,
        practice && { recommendation: { contentVersionId: practice.contentVersionId, title: practice.title, why: "practises writing boundary tests, graded against planted bugs" } },
      ),
    );
  }

  // 2. Hints: most recent passes came after hints.
  const passes = recent.filter((submission) => submission.outcome === "succeeded");
  const hinted = passes.filter((submission) => submission.hintLevel > 0);
  if (reportable(hinted.length, passes.length)) {
    const retry = quests.find((quest) => quest.contentVersionId === hinted[hinted.length - 1].contentVersionId);
    insights.push(
      insight(
        "hint_reliance",
        hinted,
        passes.length,
        `You passed ${hinted.length} of your last ${passes.length} quests after using hints. Next time, give it a few minutes on your own first — hints stay available and never cost XP.`,
        retry && { recommendation: { contentVersionId: retry.contentVersionId, title: retry.title, why: "solve it again without hints to show it independently" } },
      ),
    );
  }

  // 3. Compile errors.
  const compileErrors = recent.filter((submission) => submission.outcome === "compile-error");
  if (reportable(compileErrors.length, recent.length)) {
    insights.push(
      insight(
        "compile_errors",
        compileErrors,
        recent.length,
        `${compileErrors.length} of your last ${recent.length} submissions didn't compile. Use Run samples first: it compiles and checks your code without recording an attempt.`,
      ),
    );
  }

  // 4. A skill with repeated failures.
  const skills = [...new Set(recent.flatMap((submission) => submission.skills))].sort();
  for (const skillId of skills) {
    const attempts = recent.filter((submission) => submission.skills.includes(skillId));
    const failed = attempts.filter((submission) => submission.outcome !== "succeeded");
    if (!reportable(failed.length, attempts.length)) continue;
    const name = skillNames.get(skillId) ?? skillId;
    const review = byOrder.find((quest) => quest.completed && quest.skills.includes(skillId));
    insights.push(
      insight(
        "struggling_skill",
        failed,
        attempts.length,
        `${failed.length} of your last ${attempts.length} submissions practising ${name} didn't pass yet.`,
        {
          skillId,
          ...(review && { recommendation: { contentVersionId: review.contentVersionId, title: review.title, why: `a quest you've passed that uses ${name}: revisit it to consolidate` } }),
        },
      ),
    );
  }

  return insights;
}

/** Skills with a struggling_skill insight, for the session planner's "weak skills" priority. */
export function strugglingSkills(insights: readonly Insight[]): string[] {
  return insights.flatMap((entry) => (entry.code === "struggling_skill" && entry.skillId ? [entry.skillId] : []));
}
