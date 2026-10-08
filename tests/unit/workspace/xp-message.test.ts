import { describe, expect, it } from "vitest";
import { xpMessage } from "@/components/workspace/results-panel";

describe("xpMessage", () => {
  it("xpMessage_newXpAwarded_showsTheExactAmount", () => {
    expect(xpMessage("succeeded", 50)).toBe("+50 XP");
  });

  it("xpMessage_passWithXpAlreadyEarned_saysSoInsteadOfClaimingXp", () => {
    expect(xpMessage("succeeded", 0)).toBe("No new XP: you've already earned this quest's XP.");
  });

  it("xpMessage_failedSubmission_showsNothing", () => {
    expect(xpMessage("wrong-answer", 0)).toBeUndefined();
  });
});
