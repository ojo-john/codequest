import { ARCHIVE_FORMAT, ARCHIVE_VERSION, type ArchiveData, type UnsignedArchive } from "@/lib/archive/archive-schema";

/** Archive builders with one consistent row per table; tests override only what they need. */

export const EXPORTER_ID = "11111111-1111-4111-8111-111111111111";

const SESSION = "a0000000-0000-4000-8000-000000000001";
const ITEM = "a0000000-0000-4000-8000-000000000002";
const ATTEMPT = "a0000000-0000-4000-8000-000000000003";
const EVIDENCE = "a0000000-0000-4000-8000-000000000004";
const RECOMMENDATION = "a0000000-0000-4000-8000-000000000005";
const PROJECT = "a0000000-0000-4000-8000-000000000006";
const CHECKPOINT = "a0000000-0000-4000-8000-000000000007";
const NOTE = "a0000000-0000-4000-8000-000000000008";
const REFLECTION = "a0000000-0000-4000-8000-000000000009";
const FEEDBACK = "a0000000-0000-4000-8000-00000000000a";
const T = "2026-10-01T10:00:00.123456+00:00";
const QUEST = { content_id: "cart.q1-checkout-totals", content_version: 1 };

export function archiveData(overrides: Partial<ArchiveData> = {}): ArchiveData {
  return {
    profile: { timezone: "UTC", target_role: null, settings: { show_unreviewed_content: true } },
    sessions: [{ id: SESSION, budget_minutes: 15, state: "active", client_request_key: "request-key-1", policy_version: "planner-v1", started_at: T, completed_at: null }],
    session_items: [{ id: ITEM, session_id: SESSION, ...QUEST, ordinal: 0, state: "completed", estimated_minutes: 15 }],
    attempts: [{
      id: ATTEMPT, session_item_id: ITEM, ...QUEST, response: { files: [] }, hint_level: 0, active_seconds: 120,
      state: "graded", outcome: "succeeded", rubric_version: null, created_at: T, graded_at: T,
    }],
    mastery_evidence: [{ id: EVIDENCE, attempt_id: ATTEMPT, skill_id: "java.loops", dimension: "implementation", outcome: "pass", independence: "independent", model_version: "rules-v1", created_at: T }],
    skill_states: [{ skill_id: "java.loops", dimension: "implementation", estimate: 0.25, evidence_count: 1, review_due_at: T, scheduler_version: "ladder-v1", model_version: "rules-v1", updated_at: T }],
    recommendations: [{ id: RECOMMENDATION, session_id: SESSION, reason_codes: ["new_material"], evidence_ids: [EVIDENCE], policy_version: "planner-v1", created_at: T }],
    xp_events: [{ event_key: "quest-pass:cart.q1-checkout-totals", delta: 30, created_at: T }],
    achievements: [],
    hint_requests: [{ ...QUEST, tier: 1, requested_at: T }],
    projects: [{ id: PROJECT, content_id: null, campaign_id: "campaign.shopping-cart", title: "Shopping cart", created_at: T, updated_at: T }],
    project_files: [{ project_id: PROJECT, path: "shop/Checkout.java", revision: 3, source: "package shop;\n\npublic class Checkout {}\n", updated_at: T }],
    project_checkpoints: [{ id: CHECKPOINT, project_id: PROJECT, files: { "shop/Checkout.java": "package shop;" }, label: null, created_at: T }],
    notes: [{ id: NOTE, content_id: "cart.q1-checkout-totals", body: "Remember: totals in cents.", created_at: T, updated_at: T }],
    reflections: [{ id: REFLECTION, attempt_id: ATTEMPT, body: { prompt: "what changed", answer: "the loop" }, created_at: T }],
    recommendation_feedback: [{ id: FEEDBACK, recommendation_id: RECOMMENDATION, feedback: "accepted", note: null, created_at: T }],
    ...overrides,
  };
}

export function unsignedArchive(overrides: Partial<UnsignedArchive> = {}): UnsignedArchive {
  return { format: ARCHIVE_FORMAT, version: ARCHIVE_VERSION, exportedAt: "2026-10-08T12:00:00.000Z", subject: EXPORTER_ID, data: archiveData(), ...overrides };
}
