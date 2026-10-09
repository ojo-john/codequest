import { publicContractSpec } from "@/lib/execution/contract";
import { validateSourceFiles } from "@/lib/execution/source-files";
import type { ExecutionLimits } from "@/lib/execution/limits";
import { isLearnerTest, LEARNER_TEST_ROOT } from "@/lib/execution/test-quality";
import { validateExerciseSets } from "@/lib/exercises/validate";
import { dimensionForCriterion } from "@/lib/grading/rubric";
import { ANSWER_ONLY_DIMENSIONS } from "@/lib/learning/mastery";
import type { LoadedContent, LoadedQuest } from "./repository";
import { hintTierSchema } from "./schema";

/**
 * Static content gate (spec §44, §71): everything that can be checked without running Java.
 * Execution checks (reference passes, starter doesn't) live in scripts/content-check.ts.
 */

export interface ContentIssue {
  readonly item: string;
  readonly message: string;
}

const HINT_ORDER = hintTierSchema.options;
/** Short lines (braces, imports, blank-ish) are too common to signal a leaked solution. */
const MIN_LEAK_LINE_LENGTH = 25;

function findStrictCycle(skills: NonNullable<LoadedContent["skills"]>["skills"]): string[] | undefined {
  const edges = new Map(skills.map((skill) => [skill.id, skill.prerequisites.filter((p) => p.kind === "strict").map((p) => p.skill)]));
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];
  const visit = (id: string): string[] | undefined => {
    if (state.get(id) === "done") return undefined;
    if (state.get(id) === "visiting") return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, "visiting");
    stack.push(id);
    for (const next of edges.get(id) ?? []) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(id, "done");
    return undefined;
  };
  for (const skill of skills) {
    const cycle = visit(skill.id);
    if (cycle) return cycle;
  }
  return undefined;
}

export function validateContent(content: LoadedContent, limits: Pick<ExecutionLimits, "maxSourceFiles" | "maxTotalSourceBytes">): ContentIssue[] {
  const issues: ContentIssue[] = [...content.issues];
  const skillIds = new Set(content.skills?.skills.map((skill) => skill.id) ?? []);

  if (content.skills) {
    const seen = new Set<string>();
    for (const skill of content.skills.skills) {
      if (seen.has(skill.id)) issues.push({ item: "skills.json", message: `duplicate skill ${skill.id}` });
      seen.add(skill.id);
      for (const prerequisite of skill.prerequisites) {
        if (!skillIds.has(prerequisite.skill)) issues.push({ item: "skills.json", message: `${skill.id} requires unknown skill ${prerequisite.skill}` });
        if (prerequisite.skill === skill.id) issues.push({ item: "skills.json", message: `${skill.id} requires itself` });
      }
    }
    const cycle = findStrictCycle(content.skills.skills);
    if (cycle) issues.push({ item: "skills.json", message: `strict prerequisite cycle: ${cycle.join(" -> ")}` });
  }

  const campaignSlots = new Map<string, string>();
  for (const quest of content.quests) {
    const { manifest, privateData } = quest;
    const item = manifest.id;

    for (const tag of manifest.skills) {
      if (!skillIds.has(tag.skill)) issues.push({ item, message: `unknown skill ${tag.skill}` });
    }

    const slot = `${manifest.campaign.id}#${manifest.campaign.order}`;
    const holder = campaignSlots.get(slot);
    if (holder) issues.push({ item, message: `campaign position ${slot} is also used by ${holder}` });
    campaignSlots.set(slot, item);

    for (const [label, files] of [["starter", quest.starter], ["reference", quest.reference]] as const) {
      if (files.length === 0) issues.push({ item, message: `${label} has no files` });
      const result = validateSourceFiles(files, limits);
      if (!result.ok) issues.push({ item, message: `${label} files invalid: ${JSON.stringify(result.issues)}` });
    }

    // Hints escalate in the fixed order, each tier at most once.
    const tiers = privateData.hints.map((hint) => HINT_ORDER.indexOf(hint.tier));
    if (tiers.some((tier, i) => i > 0 && tier <= tiers[i - 1])) {
      issues.push({ item, message: `hints must escalate in order ${HINT_ORDER.join(" > ")} without repeats` });
    }

    // Nothing private may appear in public files. A reference line is "to be written" when it is
    // in no starter file (given code legitimately repeats across files); such a line must not
    // appear verbatim in the instructions.
    const publicText = [...content.publicFiles.entries()].filter(([path]) => path.startsWith(`public/${item}/`)).map(([, text]) => text).join("\n");
    if (/"expect"\s*:/.test(publicText)) issues.push({ item, message: "public files contain an `expect` key" });
    const givenLines = new Set(quest.starter.flatMap((file) => file.content.split("\n").map((line) => line.trim())));
    const instructionLines = new Set(quest.instructions.split("\n").map((line) => line.trim()));
    const leaked = quest.reference
      .flatMap((file) => file.content.split("\n").map((line) => line.trim()))
      .find((line) => line.length >= MIN_LEAK_LINE_LENGTH && !givenLines.has(line) && instructionLines.has(line));
    if (leaked !== undefined) issues.push({ item, message: `reference solution line appears in the instructions: "${leaked.slice(0, 60)}"` });
    const spec = JSON.stringify(publicContractSpec(privateData.contract));
    if (spec.includes('"expect"')) issues.push({ item, message: "public contract spec still contains expectations" });

    issues.push(...validateTestQuality(quest, limits));
    issues.push(...validateRubric(quest, skillIds));
  }

  issues.push(...validateExerciseSets(content.exerciseSets, skillIds, new Set(content.quests.map((quest) => quest.manifest.id))));
  return issues;
}

/**
 * A quest that claims to assess testing must grade the learner's tests, and test-quality grading
 * must be well-formed: the target exists in the reference, every mutant really changes it, and the
 * reference tests are proper test files. (Whether the reference tests pass on the reference and
 * catch every mutant is checked by running them, in the content gate.)
 */
function validateTestQuality(quest: LoadedQuest, limits: Pick<ExecutionLimits, "maxSourceFiles" | "maxTotalSourceBytes">): ContentIssue[] {
  const item = quest.manifest.id;
  const issues: ContentIssue[] = [];
  const assessesTesting = quest.manifest.skills.some((tag) => tag.dimension === "testing");
  const quality = quest.testQuality;
  if (quality === undefined) {
    if (assessesTesting) issues.push({ item, message: "tags a testing-dimension skill but has no testQuality grading" });
    return issues;
  }
  if (!assessesTesting) issues.push({ item, message: "has testQuality grading but tags no testing-dimension skill" });

  const baseline = quest.reference.find((file) => file.path === quality.target);
  if (baseline === undefined) issues.push({ item, message: `testQuality target ${quality.target} is not in the reference` });
  const ids = new Set<string>();
  const contents = new Set<string>();
  for (const mutant of quality.mutants) {
    if (ids.has(mutant.id)) issues.push({ item, message: `duplicate mutant id ${mutant.id}` });
    ids.add(mutant.id);
    if (baseline !== undefined && mutant.content === baseline.content) issues.push({ item, message: `mutant ${mutant.id} is identical to the reference` });
    if (contents.has(mutant.content)) issues.push({ item, message: `mutant ${mutant.id} duplicates another mutant` });
    contents.add(mutant.content);
  }

  if (quality.referenceTests.length === 0) issues.push({ item, message: "testQuality has no reference tests" });
  const misplaced = quality.referenceTests.find((file) => !isLearnerTest(file.path));
  if (misplaced) issues.push({ item, message: `reference test ${misplaced.path} must be under ${LEARNER_TEST_ROOT}` });
  const combined = validateSourceFiles([...quest.reference, ...quality.referenceTests], limits);
  if (!combined.ok) issues.push({ item, message: `reference + reference tests invalid: ${JSON.stringify(combined.issues)}` });
  return issues;
}

/**
 * Rubric inputs must point at real things, and a quest that claims to assess explanation or
 * complexity must actually ask about it: those dimensions get evidence only from follow-up answers
 * (never from code passing), so a tag without a matching question would never be evidenced.
 */
function validateRubric(quest: LoadedQuest, skillIds: ReadonlySet<string>): ContentIssue[] {
  const item = quest.manifest.id;
  const issues: ContentIssue[] = [];
  const rubric = quest.privateData.rubric;
  const caseIds = new Set(quest.privateData.contract.cases.map((testCase) => testCase.id));
  for (const id of rubric?.edgeCases ?? []) {
    if (!caseIds.has(id)) issues.push({ item, message: `rubric edge case ${id} is not a contract case` });
  }
  if (rubric && new Set(rubric.edgeCases).size !== rubric.edgeCases.length) issues.push({ item, message: "rubric edge cases repeat" });

  const followUpIds = new Set<string>();
  for (const followUp of rubric?.followUps ?? []) {
    if (followUpIds.has(followUp.id)) issues.push({ item, message: `duplicate follow-up id ${followUp.id}` });
    followUpIds.add(followUp.id);
    if (!skillIds.has(followUp.skill)) issues.push({ item, message: `follow-up ${followUp.id} names unknown skill ${followUp.skill}` });
    if (followUp.answer >= followUp.options.length) issues.push({ item, message: `follow-up ${followUp.id} answer ${followUp.answer} is not one of its options` });
    if (new Set(followUp.options).size !== followUp.options.length) issues.push({ item, message: `follow-up ${followUp.id} repeats an option` });
  }

  // Code evidence and answer evidence for one attempt must not land on the same skill dimension
  // (mastery_evidence keeps one row per attempt, skill and dimension).
  for (const followUp of rubric?.followUps ?? []) {
    const dimension = dimensionForCriterion(followUp.criterion);
    const clash = !ANSWER_ONLY_DIMENSIONS.has(dimension) && quest.manifest.skills.some((tag) => tag.skill === followUp.skill && tag.dimension === dimension);
    if (clash) issues.push({ item, message: `follow-up ${followUp.id} assesses ${followUp.skill} (${dimension}), which passing code already evidences` });
  }

  for (const tag of quest.manifest.skills) {
    if (tag.dimension !== "explanation" && tag.dimension !== "complexity") continue;
    const asked = (rubric?.followUps ?? []).some((followUp) => followUp.skill === tag.skill && dimensionForCriterion(followUp.criterion) === tag.dimension);
    if (!asked) issues.push({ item, message: `tags ${tag.skill} (${tag.dimension}) but no follow-up question assesses it` });
  }
  return issues;
}
