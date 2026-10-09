import { describe, expect, it } from "vitest";
import { layoutSkillGraph } from "@/lib/learning/skill-graph-layout";
import { buildSkillTree, MAX_RECOMMENDED_TASKS, type TreeInput } from "@/lib/learning/skill-tree";

const NOW = new Date("2026-10-09T12:00:00Z");
const WORLDS = [
  { id: "w2", number: 2, name: "Caverns", summary: "Big-O.", available: true },
  { id: "w1", number: 1, name: "Java", summary: "Java.", available: true },
  { id: "w9", number: 9, name: "Later", summary: "Later.", available: false },
];
const SKILLS = [
  { id: "loops", name: "Loops", definition: "Loop.", difficulty: 1, worldId: "w1" },
  { id: "bigo", name: "Loop analysis", definition: "Analyse.", difficulty: 2, worldId: "w2" },
  { id: "window", name: "Sliding window", definition: "Window.", difficulty: 3, worldId: "w2" },
];
const EDGES = [
  { skillId: "bigo", prerequisiteId: "loops", kind: "strict" as const },
  { skillId: "window", prerequisiteId: "bigo", kind: "strict" as const },
  { skillId: "window", prerequisiteId: "loops", kind: "recommended" as const },
];

function input(overrides: Partial<TreeInput> = {}): TreeInput {
  return { worlds: WORLDS, skills: SKILLS, edges: EDGES, states: [], practice: [], tasks: [], ...overrides };
}

const skill = (tree: ReturnType<typeof buildSkillTree>, id: string) => tree.flatMap((world) => world.skills).find((entry) => entry.id === id)!;

describe("buildSkillTree", () => {
  it("buildSkillTree_ordersWorldsByNumberAndKeepsEmptyUnavailableWorlds", () => {
    const tree = buildSkillTree(input(), NOW);

    expect(tree.map((world) => [world.name, world.skills.length, world.available])).toEqual([["Java", 1, true], ["Caverns", 2, true], ["Later", 0, false]]);
  });

  it("buildSkillTree_noEvidence_hasNoDimensionsAndNoDates", () => {
    expect(skill(buildSkillTree(input(), NOW), "loops")).toMatchObject({ dimensions: [], evidenceCount: 0, lastPracticedAt: null, nextReviewAt: null });
  });

  it("buildSkillTree_dimensions_carryStateEvidenceAndDates", () => {
    const tree = buildSkillTree(
      input({
        states: [
          { skillId: "loops", dimension: "implementation", estimate: 0.5, evidenceCount: 2, reviewDueAt: new Date("2026-10-12T00:00:00Z") },
          { skillId: "loops", dimension: "complexity", estimate: 0.1, evidenceCount: 1, reviewDueAt: new Date("2026-10-10T00:00:00Z") },
        ],
        practice: [{ skillId: "loops", dimension: "implementation", evidenceCount: 2, lastPracticedAt: new Date("2026-10-08T00:00:00Z") }],
      }),
      NOW,
    );

    expect(skill(tree, "loops")).toMatchObject({
      evidenceCount: 3,
      lastPracticedAt: "2026-10-08T00:00:00.000Z",
      nextReviewAt: "2026-10-10T00:00:00.000Z",
      dimensions: [{ dimension: "complexity", lastPracticedAt: null }, { dimension: "implementation", state: "developing" }],
    });
  });

  it("buildSkillTree_prerequisites_listStrictBeforeRecommended", () => {
    expect(skill(buildSkillTree(input(), NOW), "window").prerequisites).toEqual([
      { id: "bigo", name: "Loop analysis", kind: "strict" },
      { id: "loops", name: "Loops", kind: "recommended" },
    ]);
  });

  it("buildSkillTree_unlocks_listDependentSkills", () => {
    expect(skill(buildSkillTree(input(), NOW), "loops").unlocks.map((entry) => entry.id)).toEqual(["bigo", "window"]);
  });

  it("buildSkillTree_recommended_putsUnfinishedFirstAndCapsTheList", () => {
    const tasks = [
      { skillId: "loops", kind: "quest" as const, contentVersionId: "q1", title: "Done one", completed: true },
      ...Array.from({ length: 4 }, (_, index) => ({ skillId: "loops", kind: "practice" as const, contentVersionId: `p${index}`, title: `Set ${index}`, completed: false })),
    ];

    const recommended = skill(buildSkillTree(input({ tasks }), NOW), "loops").recommended;

    expect([recommended.length, recommended.some((task) => task.completed)]).toEqual([MAX_RECOMMENDED_TASKS, false]);
  });
});

describe("layoutSkillGraph", () => {
  const skills = [
    { id: "loops", worldNumber: 1 },
    { id: "bigo", worldNumber: 2 },
    { id: "window", worldNumber: 4 },
    { id: "strings", worldNumber: 1 },
  ];

  it("layoutSkillGraph_strictChains_pointRight", () => {
    const nodes = layoutSkillGraph({ skills, edges: EDGES });

    expect(Object.fromEntries(nodes.map((node) => [node.id, node.column]))).toEqual({ loops: 0, strings: 0, bigo: 1, window: 2 });
  });

  it("layoutSkillGraph_recommendedEdges_dontMoveNodes", () => {
    const nodes = layoutSkillGraph({ skills, edges: [{ skillId: "loops", prerequisiteId: "window", kind: "recommended" }] });

    expect(nodes.every((node) => node.column === 0)).toBe(true);
  });

  it("layoutSkillGraph_aCycle_doesNotLoopForever", () => {
    const cyclic = [
      { skillId: "loops", prerequisiteId: "bigo", kind: "strict" as const },
      { skillId: "bigo", prerequisiteId: "loops", kind: "strict" as const },
    ];

    expect(layoutSkillGraph({ skills, edges: cyclic })).toHaveLength(4);
  });

  it("layoutSkillGraph_rowsWithinAColumn_followWorldOrder", () => {
    const nodes = layoutSkillGraph({ skills: [{ id: "z", worldNumber: 1 }, { id: "a", worldNumber: 3 }], edges: [] });

    expect(nodes.map((node) => [node.id, node.row])).toEqual([["z", 0], ["a", 1]]);
  });
});
