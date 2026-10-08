import { publicContractSpec } from "@/lib/execution/contract";
import { validateSourceFiles } from "@/lib/execution/source-files";
import type { ExecutionLimits } from "@/lib/execution/limits";
import type { LoadedContent } from "./repository";
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
  }

  return issues;
}
