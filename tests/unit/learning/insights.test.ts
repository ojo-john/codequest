import { describe, expect, it } from "vitest";
import { deriveInsights, strugglingSkills, type QuestRef, type SubmissionSummary } from "@/lib/learning/insights";

const NOW = new Date("2026-10-20T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const NAMES = new Map([["java.loops", "Loops"]]);

const Q1: QuestRef = { contentVersionId: "v1", contentId: "cart.q1", title: "Checkout totals", order: 1, completed: true, skills: ["java.loops"], gradesTests: false };
const Q8: QuestRef = { contentVersionId: "v8", contentId: "cart.q8", title: "Order line parser", order: 8, completed: false, skills: ["java.input-validation"], gradesTests: true };

let counter = 0;
function submission(overrides: Partial<SubmissionSummary> = {}): SubmissionSummary {
  counter += 1;
  return {
    attemptId: `a${counter}`,
    contentVersionId: "v1",
    contentId: "cart.q1",
    createdAt: new Date(NOW.getTime() - counter * 60_000),
    outcome: "succeeded",
    hintLevel: 0,
    passedCaseIds: ["main", "edge"],
    failedCaseIds: [],
    edgeCaseIds: ["edge"],
    skills: ["java.loops"],
    ...overrides,
  };
}
const edgeMiss = (extra: Partial<SubmissionSummary> = {}) => submission({ outcome: "wrong-answer", passedCaseIds: ["main"], failedCaseIds: ["edge"], ...extra });
const codes = (insights: ReturnType<typeof deriveInsights>) => insights.map((entry) => entry.code);

describe("deriveInsights", () => {
  it("deriveInsights_noSubmissions_saysNothing", () => {
    expect(deriveInsights([], [Q1], NAMES, NOW)).toEqual([]);
  });

  it("deriveInsights_twoEdgeMissesInTwoSubmissions_isBelowTheMinimumSample", () => {
    expect(codes(deriveInsights([edgeMiss(), edgeMiss()], [Q1], NAMES, NOW))).not.toContain("edge_cases_missed");
  });

  it("deriveInsights_edgeMissesInThreeOfFour_reportsWithSampleAndRecommendsTheTestingQuest", () => {
    const insights = deriveInsights([edgeMiss(), edgeMiss(), edgeMiss(), submission()], [Q1, Q8], NAMES, NOW);

    expect(insights.find((entry) => entry.code === "edge_cases_missed")).toMatchObject({
      sampleSize: 4,
      matching: 3,
      earlySignal: true,
      recommendation: { contentVersionId: "v8", title: "Order line parser" },
    });
  });

  it("deriveInsights_edgeFailWithEverythingElseFailingToo_isNotAnEdgeCasePattern", () => {
    const allFailed = () => submission({ outcome: "wrong-answer", passedCaseIds: [], failedCaseIds: ["main", "edge"] });

    expect(codes(deriveInsights([allFailed(), allFailed(), allFailed()], [Q1], NAMES, NOW))).not.toContain("edge_cases_missed");
  });

  it("deriveInsights_submissionsOutsideTheWindow_areIgnored", () => {
    const old = (extra: Partial<SubmissionSummary> = {}) => edgeMiss({ createdAt: new Date(NOW.getTime() - 31 * DAY), ...extra });

    expect(deriveInsights([old(), old(), old()], [Q1], NAMES, NOW)).toEqual([]);
  });

  it("deriveInsights_infrastructureErrors_areNotCounted", () => {
    const infra = () => submission({ outcome: "infrastructure-error", passedCaseIds: [], failedCaseIds: [] });

    expect(deriveInsights([infra(), infra(), infra(), infra()], [Q1], NAMES, NOW)).toEqual([]);
  });

  it("deriveInsights_mostPassesHinted_reportsHintRelianceAndSuggestsARetry", () => {
    const insights = deriveInsights([submission({ hintLevel: 2 }), submission({ hintLevel: 1 }), submission()], [Q1], NAMES, NOW);

    expect(insights.find((entry) => entry.code === "hint_reliance")).toMatchObject({ matching: 2, sampleSize: 3, recommendation: { contentVersionId: "v1" } });
  });

  it("deriveInsights_repeatedCompileErrors_areReported", () => {
    const broken = () => submission({ outcome: "compile-error", passedCaseIds: [], failedCaseIds: [] });

    expect(codes(deriveInsights([broken(), broken(), submission()], [Q1], NAMES, NOW))).toContain("compile_errors");
  });

  it("deriveInsights_skillFailingRepeatedly_namesItAndSuggestsAPassedQuest", () => {
    const failed = () => submission({ outcome: "wrong-answer", passedCaseIds: [], failedCaseIds: ["main"], edgeCaseIds: [] });
    const insights = deriveInsights([failed(), failed(), submission({ edgeCaseIds: [] })], [Q1], NAMES, NOW);

    const struggling = insights.find((entry) => entry.code === "struggling_skill");
    expect([struggling?.message, struggling?.recommendation?.title, strugglingSkills(insights)]).toEqual([
      "2 of your last 3 submissions practising Loops didn't pass yet.",
      "Checkout totals",
      ["java.loops"],
    ]);
  });

  it("deriveInsights_sixOrMoreSubmissions_isNotAnEarlySignal", () => {
    const insights = deriveInsights([edgeMiss(), edgeMiss(), edgeMiss(), submission(), submission(), submission()], [Q1, Q8], NAMES, NOW);

    expect(insights.find((entry) => entry.code === "edge_cases_missed")?.earlySignal).toBe(false);
  });

  it("deriveInsights_evidence_listsTheAttemptsThatShowedThePattern", () => {
    const misses = [edgeMiss(), edgeMiss()];

    const insight = deriveInsights([...misses, submission()], [Q1, Q8], NAMES, NOW).find((entry) => entry.code === "edge_cases_missed");

    expect(insight?.evidence).toEqual(misses.map((entry) => entry.attemptId));
  });
});
