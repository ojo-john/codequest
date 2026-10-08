import { describe, expect, it } from "vitest";
import type { ArchiveData } from "@/lib/archive/archive-schema";
import { remapArchiveIds, uuidV5 } from "@/lib/archive/remap";
import { archiveData } from "./archive-builders";

const EXPORTER = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";

function ids(data: ArchiveData): string[] {
  return [
    ...data.sessions.map((row) => row.id),
    ...data.session_items.flatMap((row) => [row.id, row.session_id]),
    ...data.attempts.flatMap((row) => [row.id, row.session_item_id ?? ""]),
    ...data.mastery_evidence.flatMap((row) => [row.id, row.attempt_id]),
    ...data.recommendations.flatMap((row) => [row.id, row.session_id ?? "", ...row.evidence_ids]),
    ...data.projects.map((row) => row.id),
    ...data.project_files.map((row) => row.project_id),
    ...data.project_checkpoints.flatMap((row) => [row.id, row.project_id]),
    ...data.notes.map((row) => row.id),
    ...data.reflections.flatMap((row) => [row.id, row.attempt_id]),
    ...data.recommendation_feedback.flatMap((row) => [row.id, row.recommendation_id]),
  ];
}

describe("uuidV5", () => {
  it("uuidV5_rfcExample_matchesKnownValue", () => {
    // RFC 9562 Appendix A.4: name "www.example.com" in the DNS namespace.
    expect(uuidV5("6ba7b810-9dad-11d1-80b4-00c04fd430c8", "www.example.com")).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2");
  });
});

describe("remapArchiveIds", () => {
  it("remapArchiveIds_sameAccount_keepsEveryId", () => {
    const data = archiveData();

    expect(remapArchiveIds(data, EXPORTER, EXPORTER)).toBe(data);
  });

  it("remapArchiveIds_otherAccount_replacesEveryId", () => {
    const data = archiveData();

    const remapped = ids(remapArchiveIds(data, EXPORTER, OTHER));

    expect(remapped.filter((id) => ids(data).includes(id))).toEqual([]);
  });

  it("remapArchiveIds_otherAccount_keepsReferencesConsistent", () => {
    const remapped = remapArchiveIds(archiveData(), EXPORTER, OTHER);

    expect({
      itemSession: remapped.session_items[0].session_id,
      attemptItem: remapped.attempts[0].session_item_id,
      evidenceAttempt: remapped.mastery_evidence[0].attempt_id,
      fileProject: remapped.project_files[0].project_id,
      feedbackRecommendation: remapped.recommendation_feedback[0].recommendation_id,
    }).toEqual({
      itemSession: remapped.sessions[0].id,
      attemptItem: remapped.session_items[0].id,
      evidenceAttempt: remapped.attempts[0].id,
      fileProject: remapped.projects[0].id,
      feedbackRecommendation: remapped.recommendations[0].id,
    });
  });

  it("remapArchiveIds_sameArchiveTwice_isDeterministic", () => {
    expect(remapArchiveIds(archiveData(), EXPORTER, OTHER)).toEqual(remapArchiveIds(archiveData(), EXPORTER, OTHER));
  });

  it("remapArchiveIds_differentTargetAccounts_getDifferentIds", () => {
    const a = remapArchiveIds(archiveData(), EXPORTER, OTHER);
    const b = remapArchiveIds(archiveData(), EXPORTER, "88888888-8888-4888-8888-888888888888");

    expect(a.attempts[0].id).not.toBe(b.attempts[0].id);
  });

  it("remapArchiveIds_otherAccount_producesValidVersion5Uuids", () => {
    const remapped = remapArchiveIds(archiveData(), EXPORTER, OTHER);

    expect(ids(remapped).filter((id) => id !== "").every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))).toBe(true);
  });
});
