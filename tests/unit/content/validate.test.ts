import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadContent, type LoadedContent, type LoadedQuest } from "@/lib/content/repository";
import { questManifestSchema, questPrivateSchema, type SkillsFile } from "@/lib/content/schema";
import { validateContent } from "@/lib/content/validate";

const LIMITS = { maxSourceFiles: 20, maxTotalSourceBytes: 200 * 1024 };
const REFERENCE_LINE = "        return Math.multiplyExact(unitPriceCents, quantity);";

function skills(overrides: Partial<Record<string, Array<{ skill: string; kind: "strict" | "recommended" }>>> = {}): SkillsFile {
  const make = (id: string) => ({ id, category: "java", name: id, definition: "A definition long enough.", difficulty: 1, prerequisites: overrides[id] ?? [] });
  return { skills: [make("java.a"), make("java.b"), make("java.c")] };
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
  return { skills: skillsFile, quests, issues: [], publicFiles };
}

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

    expect(messages(content([leaky])).join()).toMatch(/reference solution line appears in public files/);
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
