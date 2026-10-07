/**
 * Session planning (spec §5, §61): deterministic rules that fit a time budget and explain every
 * choice. Inputs are plain data so the policy is testable without a database.
 */

export const SESSION_POLICY_VERSION = "rules-v1";
export const BUDGET_CHOICES = [5, 15, 30, 45, 60, 90] as const;
export type BudgetMinutes = (typeof BUDGET_CHOICES)[number];

export interface QuestCandidate {
  readonly contentVersionId: string;
  readonly contentId: string;
  readonly title: string;
  readonly campaignOrder: number;
  readonly estimatedMinutes: number;
  readonly completed: boolean;
  /** Skills this quest exercises (for matching due reviews). */
  readonly skills: readonly string[];
}

export interface DueSkill {
  readonly skillId: string;
  readonly dueAt: Date;
  readonly reason: string;
}

export type PlanReason =
  | { readonly code: "continue_campaign"; readonly detail: string }
  | { readonly code: "review_due"; readonly detail: string }
  | { readonly code: "continues_later"; readonly detail: string };

export interface PlannedItem {
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

/** A revisit of a finished quest takes about half its first-time estimate. */
const REVIEW_FRACTION = 0.5;

export function planSession(budget: BudgetMinutes, quests: readonly QuestCandidate[], dueSkills: readonly DueSkill[], now: Date): SessionPlan {
  if (quests.length === 0) return { items: [], policyVersion: SESSION_POLICY_VERSION, emptyReason: "no_content" };
  const ordered = [...quests].sort((a, b) => a.campaignOrder - b.campaignOrder);
  const items: PlannedItem[] = [];
  let remaining = budget;

  // 1. Overdue reviews first (spec §5 priority), as revisits of finished quests on those skills.
  const overdue = dueSkills.filter((skill) => skill.dueAt <= now).sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  const reviewed = new Set<string>();
  for (const skill of overdue) {
    const quest = ordered.find((candidate) => candidate.completed && candidate.skills.includes(skill.skillId) && !reviewed.has(candidate.contentVersionId));
    if (quest === undefined) continue;
    const minutes = Math.max(5, Math.round(quest.estimatedMinutes * REVIEW_FRACTION));
    if (minutes > remaining) continue;
    reviewed.add(quest.contentVersionId);
    remaining -= minutes;
    items.push({
      contentVersionId: quest.contentVersionId,
      title: quest.title,
      estimatedMinutes: minutes,
      reasons: [{ code: "review_due", detail: `${skill.skillId} is due for review (${skill.reason})` }],
    });
  }

  // 2. The next unfinished quest in the campaign. It's included even if it won't fit: the budget
  //    picks the next useful slice, and the quest resumes from its saved project later (spec §69).
  const next = ordered.find((quest) => !quest.completed);
  if (next !== undefined) {
    const reasons: PlanReason[] = [{ code: "continue_campaign", detail: `next in the campaign: ${next.title}` }];
    if (next.estimatedMinutes > remaining) {
      reasons.push({ code: "continues_later", detail: `about ${next.estimatedMinutes} min; your progress is saved between sittings` });
    }
    items.push({ contentVersionId: next.contentVersionId, title: next.title, estimatedMinutes: next.estimatedMinutes, reasons });
  }

  if (items.length === 0) return { items, policyVersion: SESSION_POLICY_VERSION, emptyReason: "campaign_complete" };
  return { items, policyVersion: SESSION_POLICY_VERSION };
}
