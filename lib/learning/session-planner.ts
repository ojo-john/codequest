import { LEARNING_SHARE, type Stage } from "./endgame";

/**
 * Session planning (spec §5, §54, §61): deterministic rules that fit a time budget and explain
 * every choice. Inputs are plain data so the policy is testable without a database.
 */

export const SESSION_POLICY_VERSION = "rules-v1";
export const BUDGET_CHOICES = [5, 15, 30, 45, 60, 90] as const;
export type BudgetMinutes = (typeof BUDGET_CHOICES)[number];

export interface QuestCandidate {
  readonly contentVersionId: string;
  readonly contentId: string;
  readonly title: string;
  readonly campaignOrder: number;
  /** Where the quest's campaign sits in the game (its world number); lower comes first. */
  readonly trackRank: number;
  readonly estimatedMinutes: number;
  readonly completed: boolean;
  /** Skills this quest exercises (for matching due reviews). */
  readonly skills: readonly string[];
}

/** A practice set the planner may schedule (spec §5: flash, recognition and complexity questions). */
export interface PracticeCandidate {
  readonly contentVersionId: string;
  readonly title: string;
  readonly estimatedMinutes: number;
  readonly worldNumber: number;
  readonly worldOrder: number;
  readonly skills: readonly string[];
  /** Share of the set's questions answered correctly so far (0–1). */
  readonly passedShare: number;
}

export interface DueSkill {
  readonly skillId: string;
  readonly dueAt: Date;
  readonly reason: string;
}

export type PlanReason =
  | { readonly code: "continue_campaign"; readonly detail: string }
  | { readonly code: "review_due"; readonly detail: string }
  | { readonly code: "weak_skill"; readonly detail: string }
  | { readonly code: "continues_later"; readonly detail: string }
  | { readonly code: "practice_review"; readonly detail: string }
  | { readonly code: "practice_new"; readonly detail: string }
  | { readonly code: "stage_mix"; readonly detail: string };

export interface PlannedItem {
  readonly kind: "quest" | "practice";
  readonly contentVersionId: string;
  readonly title: string;
  readonly estimatedMinutes: number;
  readonly reasons: readonly PlanReason[];
}

export interface SessionPlan {
  readonly items: readonly PlannedItem[];
  readonly policyVersion: string;
  /** Shown when there is nothing to do (e.g. no visible content yet). */
  readonly emptyReason?: "no_content" | "campaign_complete";
}

/** Budgets this short get a practice set only: no room for a coding quest (spec §5). */
const PRACTICE_ONLY_BUDGET = 5;

/** A revisit of a finished quest takes about half its first-time estimate. */
const REVIEW_FRACTION = 0.5;

export function planSession(
  budget: BudgetMinutes,
  quests: readonly QuestCandidate[],
  dueSkills: readonly DueSkill[],
  now: Date,
  /** Skills with repeated recent failures (lib/learning/insights), in priority order. */
  weakSkills: readonly string[] = [],
  practice: readonly PracticeCandidate[] = [],
  /** The learner's endgame stage (spec §54); it sets how much of the budget goes to practice sets. */
  stage: Stage = "middle",
): SessionPlan {
  if (quests.length === 0 && practice.length === 0) return { items: [], policyVersion: SESSION_POLICY_VERSION, emptyReason: "no_content" };
  const ordered = [...quests].sort((a, b) => a.trackRank - b.trackRank || a.campaignOrder - b.campaignOrder);
  const items: PlannedItem[] = [];
  let remaining = budget;

  const overdueSkillIds = dueSkills.filter((skill) => skill.dueAt <= now).map((skill) => skill.skillId);
  const chosen = choosePractice(practice, overdueSkillIds, weakSkills);
  // A 5-minute session is just practice questions when there are any; otherwise a quest slice.
  const practiceOnly = budget <= PRACTICE_ONLY_BUDGET && chosen !== undefined;
  // 1. Overdue reviews first (spec §5 priority), as revisits of finished quests on those skills.
  const overdue = dueSkills.filter((skill) => skill.dueAt <= now).sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  const reviewed = new Set<string>();
  for (const skill of practiceOnly ? [] : overdue) {
    const quest = ordered.find((candidate) => candidate.completed && candidate.skills.includes(skill.skillId) && !reviewed.has(candidate.contentVersionId));
    if (quest === undefined) continue;
    const minutes = Math.max(5, Math.round(quest.estimatedMinutes * REVIEW_FRACTION));
    if (minutes > remaining) continue;
    reviewed.add(quest.contentVersionId);
    remaining -= minutes;
    items.push({
      kind: "quest",
      contentVersionId: quest.contentVersionId,
      title: quest.title,
      estimatedMinutes: minutes,
      reasons: [{ code: "review_due", detail: `${skill.skillId} is due for review (${skill.reason})` }],
    });
  }

  // 2. Weak skills (spec §5's second priority): revisit a passed quest that uses the skill.
  for (const skillId of practiceOnly ? [] : weakSkills) {
    const quest = ordered.find((candidate) => candidate.completed && candidate.skills.includes(skillId) && !reviewed.has(candidate.contentVersionId));
    if (quest === undefined) continue;
    const minutes = Math.max(5, Math.round(quest.estimatedMinutes * REVIEW_FRACTION));
    if (minutes > remaining) continue;
    reviewed.add(quest.contentVersionId);
    remaining -= minutes;
    items.push({
      kind: "quest",
      contentVersionId: quest.contentVersionId,
      title: quest.title,
      estimatedMinutes: minutes,
      reasons: [{ code: "weak_skill", detail: `recent submissions using ${skillId} haven't passed yet` }],
    });
  }

  // 3. Practice sets. The first covers an overdue or weak skill if there is one, else the next
  //    unfinished set in world order. The late stage skips practice unless fundamentals need work
  //    (spec §54: don't force the ratio). Further sets fill the stage's learning share.
  const fundamentalsNeedWork = overdueSkillIds.length > 0 || weakSkills.length > 0;
  const effectiveStage: Stage = stage === "late" && fundamentalsNeedWork ? "middle" : stage;
  const learningBudget = Math.round(budget * LEARNING_SHARE[effectiveStage]);
  let learningUsed = 0;
  const skipPractice = effectiveStage === "late" && !practiceOnly;
  if (chosen !== undefined && !skipPractice && (practiceOnly || chosen.set.estimatedMinutes <= remaining)) {
    remaining -= Math.min(remaining, chosen.set.estimatedMinutes);
    learningUsed += chosen.set.estimatedMinutes;
    items.push({ kind: "practice", contentVersionId: chosen.set.contentVersionId, title: chosen.set.title, estimatedMinutes: chosen.set.estimatedMinutes, reasons: [chosen.reason] });
  }
  if (practiceOnly) return { items, policyVersion: SESSION_POLICY_VERSION };
  for (const set of skipPractice ? [] : nextPracticeSets(practice, chosen?.set)) {
    if (learningUsed + set.estimatedMinutes > learningBudget || set.estimatedMinutes > remaining) continue;
    remaining -= set.estimatedMinutes;
    learningUsed += set.estimatedMinutes;
    items.push({
      kind: "practice",
      contentVersionId: set.contentVersionId,
      title: set.title,
      estimatedMinutes: set.estimatedMinutes,
      reasons: [{ code: "stage_mix", detail: `${effectiveStage} stage: about ${Math.round(LEARNING_SHARE[effectiveStage] * 100)}% of a session is learning` }],
    });
  }

  // 4. The next unfinished quest in the campaign. It's included even if it won't fit: the budget
  //    picks the next useful slice, and the quest resumes from its saved project later (spec §69).
  const next = ordered.find((quest) => !quest.completed);
  if (next !== undefined) {
    const reasons: PlanReason[] = [{ code: "continue_campaign", detail: `next in the campaign: ${next.title}` }];
    if (next.estimatedMinutes > remaining) {
      reasons.push({ code: "continues_later", detail: `about ${next.estimatedMinutes} min; your progress is saved between sittings` });
    }
    items.push({ kind: "quest", contentVersionId: next.contentVersionId, title: next.title, estimatedMinutes: next.estimatedMinutes, reasons });
    remaining -= Math.min(remaining, next.estimatedMinutes);
  }

  // 5. Late stage: the rest of the budget goes to further problems that fit.
  for (const quest of effectiveStage === "late" ? ordered.filter((candidate) => !candidate.completed && candidate !== next) : []) {
    if (quest.estimatedMinutes > remaining) continue;
    remaining -= quest.estimatedMinutes;
    items.push({
      kind: "quest",
      contentVersionId: quest.contentVersionId,
      title: quest.title,
      estimatedMinutes: quest.estimatedMinutes,
      reasons: [{ code: "stage_mix", detail: "late stage: most of a session is problems" }],
    });
  }

  if (items.length === 0) return { items, policyVersion: SESSION_POLICY_VERSION, emptyReason: "campaign_complete" };
  return { items, policyVersion: SESSION_POLICY_VERSION };
}

function choosePractice(
  practice: readonly PracticeCandidate[],
  overdueSkills: readonly string[],
  weakSkills: readonly string[],
): { set: PracticeCandidate; reason: PlanReason } | undefined {
  for (const skillId of [...overdueSkills, ...weakSkills]) {
    const set = practice.find((candidate) => candidate.skills.includes(skillId));
    if (set) return { set, reason: { code: "practice_review", detail: `practises ${skillId}, which is due or recently missed` } };
  }
  const next = [...practice]
    .filter((candidate) => candidate.passedShare < 1)
    .sort((a, b) => a.worldNumber - b.worldNumber || a.worldOrder - b.worldOrder || a.passedShare - b.passedShare)[0];
  return next && { set: next, reason: { code: "practice_new", detail: `next practice: ${next.title}` } };
}

/** Unfinished practice sets after the first one chosen, in world order. */
function nextPracticeSets(practice: readonly PracticeCandidate[], first: PracticeCandidate | undefined): PracticeCandidate[] {
  return [...practice]
    .filter((candidate) => candidate.passedShare < 1 && candidate !== first)
    .sort((a, b) => a.worldNumber - b.worldNumber || a.worldOrder - b.worldOrder || a.passedShare - b.passedShare);
}
