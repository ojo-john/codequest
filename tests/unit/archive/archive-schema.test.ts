import { describe, expect, it } from "vitest";
import { ARCHIVE_ROW_LIMITS, archiveDataSchema, archiveSchema } from "@/lib/archive/archive-schema";
import { archiveData, unsignedArchive } from "./archive-builders";

describe("archiveSchema", () => {
  it("archiveSchema_fullArchive_parsesUnchanged", () => {
    const archive = { ...unsignedArchive(), signature: null };

    expect(archiveSchema.parse(archive)).toEqual(archive);
  });

  it("archiveSchema_postgresTimestampWithMicroseconds_isAccepted", () => {
    expect(archiveDataSchema.safeParse(archiveData()).success).toBe(true);
  });

  it("archiveSchema_unknownTopLevelField_isRejected", () => {
    expect(archiveSchema.safeParse({ ...unsignedArchive(), signature: null, extra: 1 }).success).toBe(false);
  });

  it("archiveSchema_unknownRowField_isRejected", () => {
    const data = archiveData();
    const sessions = [{ ...data.sessions[0], user_id: "99999999-9999-4999-8999-999999999999" }];

    expect(archiveDataSchema.safeParse({ ...data, sessions }).success).toBe(false);
  });

  it("archiveSchema_gradedAttemptWithoutGradedAt_isRejected", () => {
    const data = archiveData();

    expect(archiveDataSchema.safeParse({ ...data, attempts: [{ ...data.attempts[0], graded_at: null }] }).success).toBe(false);
  });

  it("archiveSchema_xpDeltaAboveLedgerMaximum_isRejected", () => {
    const data = archiveData();

    expect(archiveDataSchema.safeParse({ ...data, xp_events: [{ ...data.xp_events[0], delta: 1001 }] }).success).toBe(false);
  });

  it("archiveSchema_tooManyProjects_isRejected", () => {
    const data = archiveData();
    const projects = Array.from({ length: ARCHIVE_ROW_LIMITS.projects + 1 }, () => data.projects[0]);

    expect(archiveDataSchema.safeParse({ ...data, projects }).success).toBe(false);
  });

  it("archiveSchema_archiveWithoutFollowUpAnswers_staysWithoutThem", () => {
    // Older archives have no followup_answers; adding a default would change their canonical JSON
    // and break their signatures.
    const parsed = archiveDataSchema.parse(archiveData());

    expect("followup_answers" in parsed).toBe(false);
  });

  it("archiveSchema_followUpChoiceOutOfRange_isRejected", () => {
    const data = archiveData({ followup_answers: [{ id: crypto.randomUUID(), attempt_id: crypto.randomUUID(), followup_id: "why", choice: 10, correct: true, created_at: "2026-10-01T10:00:00Z" }] });

    expect(archiveDataSchema.safeParse(data).success).toBe(false);
  });

  it("archiveSchema_emptyTables_areValid", () => {
    const empty = archiveData({
      profile: null, sessions: [], session_items: [], attempts: [], mastery_evidence: [], skill_states: [], recommendations: [],
      xp_events: [], achievements: [], hint_requests: [], projects: [], project_files: [], project_checkpoints: [], notes: [],
      reflections: [], recommendation_feedback: [],
    });

    expect(archiveDataSchema.safeParse(empty).success).toBe(true);
  });
});
