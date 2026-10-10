import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadContent, type LoadedContent, type LoadedQuest } from "@/lib/content/repository";
import { questManifestSchema, questPrivateSchema, type SkillsFile } from "@/lib/content/schema";
import { validateContent } from "@/lib/content/validate";

const LIMITS = { maxSourceFiles: 20, maxTotalSourceBytes: 200 * 1024 };
const REFERENCE_LINE = "        return Math.multiplyExact(unitPriceCents, quantity);";

function skills(overrides: Partial<Record<string, Array<{ skill: string; kind: "strict" | "recommended" }>>> = {}): SkillsFile {
  const make = (id: string) => ({ id, category: "java", name: id, world: "world.test", definition: "A definition long enough.", difficulty: 1, prerequisites: overrides[id] ?? [] });
  return {
    worlds: [{ id: "world.test", number: 1, name: "Test", summary: "A test world.", available: true }],
    skills: [make("java.a"), make("java.b"), make("java.c")],
  };
}

function quest(id = "cart.q1-x", overrides: { order?: number; hints?: Array<{ tier: string; text: string }>; instructions?: string; skill?: string } = {}): LoadedQuest {
  return {
    manifest: questManifestSchema.parse({
      kind: "quest",
      id,
      version: 1,
      title: "A quest",
      summary: "A summary that is long enough.",
      campaign: { id: "campaign.test", order: overrides.order ?? 1 },
      stage: "completion",
      estimatedMinutes: 10,
      skills: [{ skill: overrides.skill ?? "java.a", dimension: "implementation" }],
      instructions: "instructions.md",
      starterDir: "starter",
      starterCompiles: true,
      review: { status: "draft" },
      provenance: { author: "test", license: "test", source: "original" },
    }),
    instructions: overrides.instructions ?? "Write the method.",
    starter: [{ path: "shop/Checkout.java", content: "class Checkout { long f() { return 0; } }" }],
    privateData: questPrivateSchema.parse({
      contract: { version: 1, cases: [{ id: "c", steps: [{ call: "f", static: "shop.Checkout", args: [], paramTypes: [], expect: { value: 1 } }] }] },
      hints: overrides.hints ?? [{ tier: "direction", text: "Think about it." }, { tier: "pattern", text: "Accumulate it." }],
      referenceDir: "reference",
    }),
    reference: [{ path: "shop/Checkout.java", content: `class Checkout {\n${REFERENCE_LINE}\n}` }],
  };
}

function content(quests: LoadedQuest[], skillsFile: SkillsFile | undefined = skills()): LoadedContent {
  const publicFiles = new Map<string, string>();
  for (const q of quests) {
    publicFiles.set(`public/${q.manifest.id}/instructions.md`, q.instructions);
    for (const file of q.starter) publicFiles.set(`public/${q.manifest.id}/starter/${file.path}`, file.content);
  }
  return { skills: skillsFile, campaigns: CAMPAIGNS, quests, exerciseSets: [], issues: [], publicFiles };
}

const CAMPAIGNS = { campaigns: [{ id: "campaign.test", title: "Test campaign", summary: "A test campaign.", world: "world.test", kind: "project" as const }] };

const messages = (c: LoadedContent) => validateContent(c, LIMITS).map((issue) => issue.message);

describe("validateContent", () => {
  it("validateContent_strictPrerequisiteCycle_isReported", () => {
    const cyclic = skills({ "java.a": [{ skill: "java.b", kind: "strict" }], "java.b": [{ skill: "java.a", kind: "strict" }] });

    expect(messages(content([], cyclic)).join()).toMatch(/strict prerequisite cycle/);
  });

  it("validateContent_recommendedBackEdge_isAllowed", () => {
    const ordered = skills({ "java.a": [{ skill: "java.b", kind: "strict" }], "java.b": [{ skill: "java.a", kind: "recommended" }] });

    expect(messages(content([], ordered))).toEqual([]);
  });

  it("validateContent_prerequisiteOnUnknownSkill_isReported", () => {
    expect(messages(content([], skills({ "java.a": [{ skill: "java.zzz", kind: "strict" }] }))).join()).toMatch(/unknown skill java.zzz/);
  });

  it("validateContent_questTagsUnknownSkill_isReported", () => {
    expect(messages(content([quest("cart.q1-x", { skill: "java.unknown" })])).join()).toMatch(/unknown skill java.unknown/);
  });

  it("validateContent_twoQuestsInSameCampaignSlot_isReported", () => {
    expect(messages(content([quest("cart.q1-x"), quest("cart.q2-y")])).join()).toMatch(/campaign position .* also used/);
  });

  it("validateContent_hintsOutOfOrder_isReported", () => {
    const shuffled = [{ tier: "pattern", text: "Accumulate it." }, { tier: "direction", text: "Think about it." }];

    expect(messages(content([quest("cart.q1-x", { hints: shuffled })])).join()).toMatch(/hints must escalate/);
  });

  it("validateContent_referenceLineInInstructions_isReportedAsLeak", () => {
    const leaky = quest("cart.q1-x", { instructions: `Hint:\n${REFERENCE_LINE}` });

    expect(messages(content([leaky])).join()).toMatch(/reference solution line appears in the instructions/);
  });

  it("validateContent_referenceLineGivenInAnotherStarterFile_isNotALeak", () => {
    const given = quest("cart.q1-x", { instructions: `Example:\n${REFERENCE_LINE}` });
    const withGivenCode: LoadedQuest = { ...given, starter: [...given.starter, { path: "shop/Other.java", content: REFERENCE_LINE }] };

    expect(messages(content([withGivenCode]))).toEqual([]);
  });

  it("validateContent_expectKeyInPublicFiles_isReported", () => {
    const leaky = quest("cart.q1-x", { instructions: '{"expect": {"value": 1150}}' });

    expect(messages(content([leaky])).join()).toMatch(/`expect` key/);
  });

  it("validateContent_loadIssues_arePropagated", () => {
    const broken: LoadedContent = { ...content([]), issues: [{ item: "cart.q9", message: "bad json" }] };

    expect(messages(broken)).toContain("bad json");
  });

  it("validateContent_validContent_hasNoIssues", () => {
    expect(messages(content([quest()]))).toEqual([]);
  });
});

describe("repository content", () => {
  it("loadContent_realCurriculum_passesStaticGate", () => {
    const loaded = loadContent(join(import.meta.dirname, "..", "..", "..", "content"));

    expect(validateContent(loaded, LIMITS)).toEqual([]);
    expect(loaded.quests.length).toBeGreaterThan(0);
  });
});

describe("validateContent rubric", () => {
  const FOLLOW_UP = { id: "why", criterion: "explanation", skill: "java.a", prompt: "Why does it work?", options: ["one", "two"], answer: 1, why: "Because it does." };

  function withRubric(rubric: unknown, dimension: "implementation" | "explanation" = "implementation"): LoadedQuest {
    const base = quest();
    return {
      ...base,
      manifest: { ...base.manifest, skills: [{ skill: "java.a", dimension }] },
      privateData: questPrivateSchema.parse({ ...base.privateData, rubric }),
    };
  }

  it("validateContent_wellFormedRubric_hasNoIssues", () => {
    expect(messages(content([withRubric({ edgeCases: ["c"], followUps: [FOLLOW_UP] }, "explanation")]))).toEqual([]);
  });

  it("validateContent_edgeCaseNotInTheContract_isReported", () => {
    expect(messages(content([withRubric({ edgeCases: ["nope"] })])).join()).toMatch(/edge case nope is not a contract case/);
  });

  it("validateContent_answerOutsideTheOptions_isReported", () => {
    expect(messages(content([withRubric({ followUps: [{ ...FOLLOW_UP, answer: 2 }] })])).join()).toMatch(/answer 2 is not one of its options/);
  });

  it("validateContent_followUpForUnknownSkill_isReported", () => {
    expect(messages(content([withRubric({ followUps: [{ ...FOLLOW_UP, skill: "java.zzz" }] })])).join()).toMatch(/unknown skill java.zzz/);
  });

  it("validateContent_explanationTagWithoutAQuestion_isReported", () => {
    expect(messages(content([withRubric(undefined, "explanation")])).join()).toMatch(/no follow-up question assesses it/);
  });

  it("validateContent_followUpOnACodeEvidencedDimension_isReported", () => {
    const base = withRubric({ followUps: [{ ...FOLLOW_UP, criterion: "algorithm_choice" }] });
    const clashing = { ...base, manifest: { ...base.manifest, skills: [{ skill: "java.a", dimension: "recognition" as const }] } };

    expect(messages(content([clashing])).join()).toMatch(/passing code already evidences/);
  });

  it("validateContent_duplicateFollowUpIds_areReported", () => {
    expect(messages(content([withRubric({ followUps: [FOLLOW_UP, FOLLOW_UP] })])).join()).toMatch(/duplicate follow-up id why/);
  });
});

describe("validateContent worlds", () => {
  it("validateContent_skillInUnknownWorld_isReported", () => {
    const file = skills();
    const broken = { ...file, skills: [{ ...file.skills[0], world: "world.nowhere" }, ...file.skills.slice(1)] };

    expect(messages(content([], broken)).join()).toMatch(/java.a is in unknown world world.nowhere/);
  });

  it("validateContent_repeatedWorldNumbers_areReported", () => {
    const file = skills();
    const broken = { ...file, worlds: [...file.worlds, { ...file.worlds[0], id: "world.other" }] };

    expect(messages(content([], broken)).join()).toMatch(/world numbers repeat/);
  });
});

describe("validateContent campaigns", () => {
  it("validateContent_questInUnknownCampaign_isReported", () => {
    const base = quest();
    const stray = { ...base, manifest: { ...base.manifest, campaign: { id: "campaign.nowhere", order: 1 } } };

    expect(messages(content([stray])).join()).toMatch(/unknown campaign campaign.nowhere/);
  });

  it("validateContent_campaignInUnknownWorld_isReported", () => {
    const broken = { ...content([]), campaigns: { campaigns: [{ ...CAMPAIGNS.campaigns[0], world: "world.nowhere" }] } };

    expect(messages(broken).join()).toMatch(/campaign.test is in unknown world world.nowhere/);
  });
});
