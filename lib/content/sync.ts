import type postgres from "postgres";
import type { QuestPayload } from "./payload";
import type { ExerciseSetPayload } from "@/lib/exercises/schema";
import type { LoadedContent, LoadedExerciseSet, LoadedQuest } from "./repository";

/**
 * Loads repository content into the database in ONE transaction (spec §45):
 *   - skills are upserted and prerequisite edges replaced (the DB trigger rejects strict cycles)
 *   - each quest and exercise-set version is inserted, or updated while it is still a draft
 *   - a published/deprecated version can only change status (published -> deprecated); a change
 *     to its payload, tags or hidden grading is refused: scored attempts reference that exact
 *     version, so a change needs a new version number
 * Anything refused aborts the whole sync, leaving the database as it was.
 */

export class ContentSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentSyncError";
  }
}

export interface SyncReport {
  readonly skills: number;
  readonly inserted: readonly string[];
  readonly updated: readonly string[];
  readonly unchanged: readonly string[];
}

const IMMUTABLE_STATUSES = new Set(["published", "deprecated"]);

function publicPayload(quest: LoadedQuest): QuestPayload {
  const { manifest } = quest;
  return {
    title: manifest.title,
    summary: manifest.summary,
    campaign: manifest.campaign,
    stage: manifest.stage,
    // Omitted when absent, so existing quests keep the payload they were synced with.
    ...(manifest.family && { family: manifest.family }),
    estimatedMinutes: manifest.estimatedMinutes,
    skills: manifest.skills,
    instructions: quest.instructions,
    starter: quest.starter.map((file) => ({ path: file.path, content: file.content })),
    starterCompiles: manifest.starterCompiles,
  };
}

function hiddenGrading(quest: LoadedQuest): Record<string, unknown> {
  const grading: Record<string, unknown> = { contract: quest.privateData.contract, hints: quest.privateData.hints };
  if (quest.privateData.rubric !== undefined) grading.rubric = quest.privateData.rubric;
  const quality = quest.testQuality;
  if (quality !== undefined) {
    // The baseline travels with the mutants so grading needs one read; validation guarantees the target exists.
    const baseline = quest.reference.find((file) => file.path === quality.target)?.content ?? "";
    grading.testQuality = { target: quality.target, baseline, passRatio: quality.passRatio, mutants: quality.mutants };
  }
  return grading;
}

function referenceSolution(quest: LoadedQuest): Record<string, unknown> {
  return { files: quest.reference.map((file) => ({ path: file.path, content: file.content })) };
}

interface SyncItem {
  readonly manifest: {
    readonly id: string;
    readonly version: number;
    readonly review: LoadedQuest["manifest"]["review"];
    readonly provenance: LoadedQuest["manifest"]["provenance"];
  };
  readonly kind: "problem" | "question";
  readonly payload: unknown;
  readonly tags: ReadonlyArray<{ readonly skill: string; readonly dimension: string }>;
  readonly hiddenGrading: Record<string, unknown>;
  readonly referenceSolution: Record<string, unknown>;
}

interface SyncProgress {
  readonly inserted: string[];
  readonly updated: string[];
  readonly unchanged: string[];
}

function exerciseSetPayload(set: LoadedExerciseSet): ExerciseSetPayload {
  const { manifest } = set;
  return {
    kind: "exercise-set",
    title: manifest.title,
    summary: manifest.summary,
    world: manifest.world,
    estimatedMinutes: manifest.estimatedMinutes,
    questions: manifest.questions,
    // Omitted when absent, so sets without sections keep the payload they were synced with.
    ...(manifest.sections && { sections: manifest.sections }),
    ...(manifest.boss && { boss: manifest.boss }),
  };
}

/** A set is tagged with every (skill, dimension) its questions assess. */
function exerciseSetTags(set: LoadedExerciseSet): Array<{ skill: string; dimension: string }> {
  const unique = new Map(Object.values(set.privateData.answers).map((answer) => [`${answer.skill}:${answer.dimension}`, { skill: answer.skill, dimension: answer.dimension }]));
  return [...unique.values()];
}

/** Inserts or updates one versioned content item, refusing changes to frozen versions. */
async function syncItem(tx: postgres.TransactionSql, item: SyncItem, progress: SyncProgress): Promise<void> {
  const { inserted, updated, unchanged } = progress;
  const { manifest, payload, kind } = item;
  const label = `${manifest.id}@v${manifest.version}`;
  const review = manifest.review;
  const reviewedAt = "reviewedAt" in review ? review.reviewedAt : null;
  const provenance = { ...manifest.provenance, ...("reviewer" in review ? { reviewer: review.reviewer } : {}) };
  const tags = item.tags.map((tag) => `${tag.skill}:${tag.dimension}`).sort();

  await tx`insert into public.content_items (id, kind) values (${manifest.id}, ${kind}) on conflict (id) do nothing`;
  const [existing] = await tx<{ id: string; status: string; same_payload: boolean; same_provenance: boolean }[]>`
    select id, status::text as status,
           payload = ${tx.json(payload as postgres.JSONValue)} as same_payload,
           provenance = ${tx.json(provenance)} as same_provenance
    from public.content_versions where content_id = ${manifest.id} and version = ${manifest.version}`;

  let versionId: string;
  if (existing === undefined) {
    const [row] = await tx<{ id: string }[]>`
      insert into public.content_versions (content_id, version, status, payload, provenance, reviewed_at)
      values (${manifest.id}, ${manifest.version}, ${review.status}, ${tx.json(payload as postgres.JSONValue)}, ${tx.json(provenance)}, ${reviewedAt})
      returning id`;
    versionId = row.id;
    inserted.push(label);
  } else {
    versionId = existing.id;
    const frozen = IMMUTABLE_STATUSES.has(existing.status);
    const sameStatus = existing.status === review.status;
    if (frozen && (!existing.same_payload || !existing.same_provenance)) {
      throw new ContentSyncError(`${label} is ${existing.status}; its content can't change — bump "version" in item.json`);
    }
    if (frozen && !sameStatus && !(existing.status === "published" && review.status === "deprecated")) {
      throw new ContentSyncError(`${label} is ${existing.status}; it can only move to deprecated`);
    }
    if (existing.same_payload && existing.same_provenance && sameStatus) {
      unchanged.push(label);
    } else {
      await tx`
        update public.content_versions
        set status = ${review.status}, reviewed_at = ${reviewedAt},
            payload = ${tx.json(payload as postgres.JSONValue)}, provenance = ${tx.json(provenance)}
        where id = ${versionId}`;
      updated.push(label);
    }
  }

  const currentTags = await tx<{ tag: string }[]>`
    select skill_id || ':' || dimension::text as tag from public.content_skill_tags
    where content_version_id = ${versionId} order by 1`;
  const tagsChanged = currentTags.map((row) => row.tag).join(",") !== tags.join(",");
  const [secrets] = await tx<{ same: boolean }[]>`
    select hidden_grading = ${tx.json(item.hiddenGrading as postgres.JSONValue)}
           and reference_solution = ${tx.json(item.referenceSolution as postgres.JSONValue)} as same
    from private.content_secrets where content_version_id = ${versionId}`;
  const secretsChanged = secrets === undefined || !secrets.same;
  const frozenNow = existing !== undefined && IMMUTABLE_STATUSES.has(existing.status);

  if (frozenNow && (tagsChanged || secretsChanged)) {
    throw new ContentSyncError(`${label} is ${existing!.status}; its skill tags and hidden grading can't change — bump "version"`);
  }
  if (tagsChanged) {
    await tx`delete from public.content_skill_tags where content_version_id = ${versionId}`;
    for (const tag of item.tags) {
      await tx`insert into public.content_skill_tags (content_version_id, skill_id, dimension)
               values (${versionId}, ${tag.skill}, ${tag.dimension})`;
    }
  }
  if (secretsChanged) {
    await tx`
      insert into private.content_secrets (content_version_id, reference_solution, hidden_grading)
      values (${versionId}, ${tx.json(item.referenceSolution as postgres.JSONValue)}, ${tx.json(item.hiddenGrading as postgres.JSONValue)})
      on conflict (content_version_id) do update
        set reference_solution = excluded.reference_solution, hidden_grading = excluded.hidden_grading`;
    if (!inserted.includes(label) && !updated.includes(label)) {
      unchanged.splice(unchanged.indexOf(label), 1);
      updated.push(label);
    }
  }
}

export async function syncContent(sql: postgres.Sql, content: LoadedContent): Promise<SyncReport> {
  if (content.issues.length > 0 || content.skills === undefined || content.campaigns === undefined) {
    throw new ContentSyncError("content has load issues; run `npm run content:check` first");
  }
  const skills = content.skills.skills;
  const inserted: string[] = [];
  const updated: string[] = [];
  const unchanged: string[] = [];
  const progress: SyncProgress = { inserted, updated, unchanged };

  await sql.begin(async (tx) => {
    for (const world of content.skills!.worlds) {
      await tx`
        insert into public.worlds (id, number, name, summary, available)
        values (${world.id}, ${world.number}, ${world.name}, ${world.summary}, ${world.available})
        on conflict (id) do update set number = excluded.number, name = excluded.name,
          summary = excluded.summary, available = excluded.available`;
    }
    for (const campaign of content.campaigns?.campaigns ?? []) {
      await tx`
        insert into public.campaigns (id, title, summary, world_id, kind)
        values (${campaign.id}, ${campaign.title}, ${campaign.summary}, ${campaign.world}, ${campaign.kind})
        on conflict (id) do update set title = excluded.title, summary = excluded.summary,
          world_id = excluded.world_id, kind = excluded.kind`;
    }
    for (const skill of skills) {
      await tx`
        insert into public.skills (id, category, name, definition, difficulty, world_id)
        values (${skill.id}, ${skill.category}, ${skill.name}, ${skill.definition}, ${skill.difficulty}, ${skill.world})
        on conflict (id) do update set category = excluded.category, name = excluded.name,
          definition = excluded.definition, difficulty = excluded.difficulty, world_id = excluded.world_id`;
    }
    // Replace the edge set: removing first lets a reordering of strict edges pass the cycle check.
    await tx`delete from public.skill_edges`;
    for (const skill of skills) {
      for (const prerequisite of skill.prerequisites) {
        await tx`insert into public.skill_edges (skill_id, prerequisite_id, edge_kind)
                 values (${skill.id}, ${prerequisite.skill}, ${prerequisite.kind})`;
      }
    }

    for (const quest of content.quests) {
      await syncItem(tx, {
        manifest: quest.manifest,
        kind: "problem",
        payload: publicPayload(quest),
        tags: quest.manifest.skills,
        hiddenGrading: hiddenGrading(quest),
        referenceSolution: referenceSolution(quest),
      }, progress);
    }
    for (const set of content.exerciseSets) {
      await syncItem(tx, {
        manifest: set.manifest,
        kind: "question",
        payload: exerciseSetPayload(set),
        tags: exerciseSetTags(set),
        hiddenGrading: { answers: set.privateData.answers },
        referenceSolution: {},
      }, progress);
    }
  });

  return { skills: skills.length, inserted, updated, unchanged };
}
