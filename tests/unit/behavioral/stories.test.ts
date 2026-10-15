import { describe, expect, it } from "vitest";
import { checkStory, coverage, QUESTIONS, spokenMinutes, storyInputSchema, type StoryInput } from "@/lib/behavioral/stories";

const sentence = (count: number, word = "word") => Array.from({ length: count }, () => word).join(" ");

function story(overrides: Partial<StoryInput> = {}): StoryInput {
  return {
    title: "Migration under deadline",
    competencies: ["ownership"],
    situation: "Our payment service had to move to a new database before the old one lost support.",
    task: "I was responsible for planning the migration and keeping downtime under an hour.",
    action: `I mapped every query, I wrote a dual-write path, and I ran a shadow comparison for a week. ${sentence(200)}`,
    result: "We switched over with twelve minutes of downtime, measured from our status page.",
    learned: "I would involve the on-call team earlier, because they found two edge cases late.",
    ...overrides,
  };
}

const status = (input: StoryInput, id: string) => checkStory(input).find((check) => check.id === id)?.status;

describe("checkStory", () => {
  it("checkStory_emptyParts_suggestEachMissingPart", () => {
    const checks = checkStory(story({ situation: "", task: "", action: "", result: "", learned: "" }));

    expect(["situation", "task", "action", "result", "learned"].map((id) => checks.find((check) => check.id === id)?.status)).toEqual(Array(5).fill("suggestion"));
  });

  it("checkStory_partJustBelowMinimumWords_isASuggestion_atMinimumIsOk", () => {
    expect([status(story({ task: sentence(7) }), "task"), status(story({ task: sentence(8) }), "task")]).toEqual(["suggestion", "ok"]);
  });

  it("checkStory_actionMostlyWe_suggestsMakingYourRoleClear", () => {
    expect(status(story({ action: "We planned it, we built it, we tested it, and we shipped it with our team. I watched." }), "own-role")).toBe("suggestion");
  });

  it("checkStory_actionWithNoPronounsAtAll_isNotFlagged", () => {
    expect(status(story({ action: "Mapped every query, wrote a dual-write path and ran a shadow comparison for a week." }), "own-role")).toBe("ok");
  });

  it("checkStory_lowercaseI_isNotCountedAsFirstPerson", () => {
    expect(checkStory(story({ action: "we did it, we built it, we ran it, we shipped it, i helped" })).find((check) => check.id === "own-role")?.message).toMatch(/"I" 0/);
  });

  it("checkStory_tooShortOrTooLong_suggestsAdjustingLength", () => {
    const short = story({ action: "I did it myself today." });
    const long = story({ action: sentence(600) });

    expect([status(short, "length"), status(long, "length"), status(story(), "length")]).toEqual(["suggestion", "suggestion", "ok"]);
  });

  it("checkStory_resultWithoutNumbers_neverDemandsOne", () => {
    const check = checkStory(story({ result: "The team adopted the new process and incidents dropped noticeably." })).find((c) => c.id === "evidence");

    expect([check?.status, check?.message]).toEqual(["ok", expect.stringMatching(/Never estimate or invent/)]);
  });

  it("checkStory_noCompetencies_suggestsTagging", () => {
    expect(status(story({ competencies: [] }), "tags")).toBe("suggestion");
  });

  it("spokenMinutes_countsWordsAtTypicalPace", () => {
    expect(spokenMinutes({ situation: sentence(150), task: "", action: sentence(150), result: "", learned: "" })).toBe(2);
  });
});

describe("story input and coverage", () => {
  it("storyInput_unknownCompetency_isRejected", () => {
    expect(storyInputSchema.safeParse({ ...story(), competencies: ["heroics"] }).success).toBe(false);
  });

  it("storyInput_duplicateCompetencies_areDeduplicated", () => {
    expect(storyInputSchema.parse({ ...story(), competencies: ["conflict", "conflict"] }).competencies).toEqual(["conflict"]);
  });

  it("storyInput_blankTitle_isRejected", () => {
    expect(storyInputSchema.safeParse({ ...story(), title: "   " }).success).toBe(false);
  });

  it("coverage_listsEveryCompetencyWithItsStories", () => {
    const result = coverage([{ id: "s1", title: "One", competencies: ["conflict", "ownership"] }]);

    expect([result.length, result.filter((entry) => entry.stories.length > 0).map((entry) => entry.id)]).toEqual([11, ["conflict", "ownership"]]);
  });

  it("questions_eachMapToAtLeastOneCompetency", () => {
    expect(QUESTIONS.every((question) => question.competencies.length > 0)).toBe(true);
  });
});
