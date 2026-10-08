import type postgres from "postgres";
import type { QuestPayload } from "./payload";
import type { LoadedContent, LoadedQuest } from "./repository";

/**
 * Loads repository content into the database in ONE transaction (spec §45):
 *   - skills are upserted and prerequisite edges replaced (the DB trigger rejects strict cycles)
 *   - each quest version is inserted, or updated while it is still a draft
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

export async function syncContent(sql: postgres.Sql, content: LoadedContent): Promise<SyncReport> {
  if (content.issues.length > 0 || content.skills === undefined) {
    throw new ContentSyncError("content has load issues; run `npm run content:check` first");
  }
  const skills = content.skills.skills;
  const inserted: string[] = [];
  const updated: string[] = [];
  const unchanged: string[] = [];

  await sql.begin(async (tx) => {
    for (const skill of skills) {
      await tx`
        insert into public.skills (id, category, name, definition, difficulty)
        values (${skill.id}, ${skill.category}, ${skill.name}, ${skill.definition}, ${skill.difficulty})
        on conflict (id) do update set category = excluded.category, name = excluded.name,
          definition = excluded.definition, difficulty = excluded.difficulty`;
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
      const { manifest } = quest;
      const label = `${manifest.id}@v${manifest.version}`;
      const review = manifest.review;
      const reviewedAt = "reviewedAt" in review ? review.reviewedAt : null;
      const provenance = { ...manifest.provenance, ...("reviewer" in review ? { reviewer: review.reviewer } : {}) };
      const payload = publicPayload(quest);
      const tags = manifest.skills.map((tag) => `${tag.skill}:${tag.dimension}`).sort();

      await tx`insert into public.content_items (id, kind) values (${manifest.id}, 'problem') on conflict (id) do nothing`;
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
        select hidden_grading = ${tx.json(hiddenGrading(quest) as postgres.JSONValue)}
               and reference_solution = ${tx.json(referenceSolution(quest) as postgres.JSONValue)} as same
        from private.content_secrets where content_version_id = ${versionId}`;
      const secretsChanged = secrets === undefined || !secrets.same;
      const frozenNow = existing !== undefined && IMMUTABLE_STATUSES.has(existing.status);

      if (frozenNow && (tagsChanged || secretsChanged)) {
        throw new ContentSyncError(`${label} is ${existing!.status}; its skill tags and hidden grading can't change — bump "version"`);
      }
      if (tagsChanged) {
        await tx`delete from public.content_skill_tags where content_version_id = ${versionId}`;
        for (const tag of manifest.skills) {
          await tx`insert into public.content_skill_tags (content_version_id, skill_id, dimension)
                   values (${versionId}, ${tag.skill}, ${tag.dimension})`;
        }
      }
      if (secretsChanged) {
        await tx`
          insert into private.content_secrets (content_version_id, reference_solution, hidden_grading)
          values (${versionId}, ${tx.json(referenceSolution(quest) as postgres.JSONValue)}, ${tx.json(hiddenGrading(quest) as postgres.JSONValue)})
          on conflict (content_version_id) do update
            set reference_solution = excluded.reference_solution, hidden_grading = excluded.hidden_grading`;
        if (!inserted.includes(label) && !updated.includes(label)) {
          unchanged.splice(unchanged.indexOf(label), 1);
          updated.push(label);
        }
      }
    }
  });

  return { skills: skills.length, inserted, updated, unchanged };
}
