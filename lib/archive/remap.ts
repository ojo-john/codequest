import { createHash } from "node:crypto";
import type { ArchiveData } from "./archive-schema";

/**
 * Row ids for an import. Restoring into the account that exported the archive keeps every id,
 * so re-importing changes nothing (each insert is "on conflict do nothing"). Importing into a
 * different account maps each id to a name-based UUID (RFC 9562 version 5) in a namespace derived
 * from the importing account, so:
 *   - ids never collide with rows another account owns, and
 *   - importing the same archive twice still maps to the same ids, so it stays idempotent.
 */

const NAMESPACE_DOMAIN = "codequest.archive.import.v1:";

function uuidBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ""), "hex");
}

function formatUuid(bytes: Buffer): string {
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** RFC 9562 UUIDv5: SHA-1 of namespace bytes + name, with version and variant bits set. */
export function uuidV5(namespace: string, name: string): string {
  const hash = createHash("sha1").update(uuidBytes(namespace)).update(name, "utf8").digest().subarray(0, 16);
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  return formatUuid(hash);
}

export function remapArchiveIds(data: ArchiveData, subject: string, targetUserId: string): ArchiveData {
  if (subject === targetUserId) return data;
  const namespace = uuidV5("00000000-0000-0000-0000-000000000000", `${NAMESPACE_DOMAIN}${targetUserId}`);
  const id = (value: string): string => uuidV5(namespace, value.toLowerCase());
  const optionalId = (value: string | null): string | null => (value === null ? null : id(value));

  return {
    ...data,
    sessions: data.sessions.map((row) => ({ ...row, id: id(row.id) })),
    session_items: data.session_items.map((row) => ({ ...row, id: id(row.id), session_id: id(row.session_id) })),
    attempts: data.attempts.map((row) => ({ ...row, id: id(row.id), session_item_id: optionalId(row.session_item_id) })),
    mastery_evidence: data.mastery_evidence.map((row) => ({ ...row, id: id(row.id), attempt_id: id(row.attempt_id) })),
    recommendations: data.recommendations.map((row) => ({
      ...row,
      id: id(row.id),
      session_id: optionalId(row.session_id),
      evidence_ids: row.evidence_ids.map(id),
    })),
    projects: data.projects.map((row) => ({ ...row, id: id(row.id) })),
    project_files: data.project_files.map((row) => ({ ...row, project_id: id(row.project_id) })),
    project_checkpoints: data.project_checkpoints.map((row) => ({ ...row, id: id(row.id), project_id: id(row.project_id) })),
    notes: data.notes.map((row) => ({ ...row, id: id(row.id) })),
    reflections: data.reflections.map((row) => ({ ...row, id: id(row.id), attempt_id: id(row.attempt_id) })),
    recommendation_feedback: data.recommendation_feedback.map((row) => ({
      ...row,
      id: id(row.id),
      recommendation_id: id(row.recommendation_id),
    })),
    ...(data.followup_answers && {
      followup_answers: data.followup_answers.map((row) => ({ ...row, id: id(row.id), attempt_id: id(row.attempt_id) })),
    }),
    ...(data.mock_interviews && { mock_interviews: data.mock_interviews.map((row) => ({ ...row, id: id(row.id) })) }),
    ...(data.behavioral_stories && { behavioral_stories: data.behavioral_stories.map((row) => ({ ...row, id: id(row.id) })) }),
    ...(data.flashcards && { flashcards: data.flashcards.map((row) => ({ ...row, id: id(row.id) })) }),
  };
}
