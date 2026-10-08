import { describe, expect, it } from "vitest";
import { isRetrievalDue, MAX_REFLECTION_ANSWER_CHARS, reflectionAnswersSchema, reflectionBody } from "@/lib/learning/reflection";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-20T12:00:00Z");

describe("reflectionAnswersSchema", () => {
  it("parse_allAnswersBlank_isRejected", () => {
    expect(reflectionAnswersSchema.safeParse({ cue: "  ", mistake: "" }).success).toBe(false);
  });

  it("parse_noAnswers_isRejected", () => {
    expect(reflectionAnswersSchema.safeParse({}).success).toBe(false);
  });

  it("parse_oneAnswer_isAccepted", () => {
    expect(reflectionAnswersSchema.safeParse({ reuse: "Any running total." }).success).toBe(true);
  });

  it("parse_unknownPrompt_isRejected", () => {
    expect(reflectionAnswersSchema.safeParse({ cue: "x", mood: "great" }).success).toBe(false);
  });

  it("parse_answerAtLimit_isAccepted", () => {
    expect(reflectionAnswersSchema.safeParse({ cue: "x".repeat(MAX_REFLECTION_ANSWER_CHARS) }).success).toBe(true);
  });

  it("parse_answerOverLimit_isRejected", () => {
    expect(reflectionAnswersSchema.safeParse({ cue: "x".repeat(MAX_REFLECTION_ANSWER_CHARS + 1) }).success).toBe(false);
  });
});

describe("reflectionBody", () => {
  it("reflectionBody_blankAnswers_areDroppedAndTheRestTrimmed", () => {
    const answers = reflectionAnswersSchema.parse({ cue: "  the word 'exact'  ", mistake: "   ", reuse: "" });

    expect(reflectionBody(answers)).toEqual({ version: "reflection-v1", answers: { cue: "the word 'exact'" } });
  });
});

describe("isRetrievalDue", () => {
  it("isRetrievalDue_sixDaysOld_isFalse", () => {
    expect(isRetrievalDue(new Date(NOW.getTime() - 6 * DAY), NOW)).toBe(false);
  });

  it("isRetrievalDue_exactlySevenDaysOld_isTrue", () => {
    expect(isRetrievalDue(new Date(NOW.getTime() - 7 * DAY), NOW)).toBe(true);
  });
});
