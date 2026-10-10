import "server-only";
import { createUserClient } from "@/lib/supabase/server";

/**
 * The learner's project for a campaign (spec §62, §69): one per campaign, carried from quest to
 * quest. Runs AS the learner (RLS). Starter files are only added when missing — existing work is
 * never overwritten by a later quest's starter.
 */

export interface ProjectFile {
  readonly path: string;
  readonly revision: number;
  readonly source: string;
}

export interface CampaignProject {
  readonly projectId: string;
  readonly files: readonly ProjectFile[];
}

export class ProjectError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ProjectError";
  }
}

/**
 * The project a quest is worked in: the campaign's shared project for a "project" campaign, or
 * the quest's own project in a "problems" campaign.
 */
export async function openQuestProject(
  userId: string,
  quest: { readonly contentId: string; readonly title: string; readonly campaignId: string; readonly starter: ReadonlyArray<{ path: string; content: string }> },
  campaign: { readonly kind: "project" | "problems"; readonly title: string } | undefined,
): Promise<CampaignProject> {
  if (campaign?.kind === "problems") return openProblemProject(userId, quest.contentId, quest.title, quest.starter);
  return openCampaignProject(userId, quest.campaignId, campaign?.title ?? quest.campaignId, quest.starter);
}

async function openProblemProject(userId: string, contentId: string, title: string, starter: ReadonlyArray<{ path: string; content: string }>): Promise<CampaignProject> {
  const supabase = await createUserClient();
  const find = () => supabase.from("projects").select("id").eq("content_id", contentId).is("campaign_id", null).maybeSingle();
  let { data: project, error } = await find();
  if (error) throw new ProjectError("couldn't load the project", { cause: error });
  if (project === null) {
    const created = await supabase.from("projects").insert({ user_id: userId, content_id: contentId, title }).select("id").single();
    // A concurrent first open may have created it already (unique per user + problem).
    if (created.error?.code === "23505") {
      ({ data: project, error } = await find());
      if (error || project === null) throw new ProjectError("couldn't load the project", { cause: error });
    } else if (created.error) {
      throw new ProjectError("couldn't create the project", { cause: created.error });
    } else {
      project = created.data;
    }
  }
  return fillProject(project.id as string, starter);
}

export async function openCampaignProject(
  userId: string,
  campaignId: string,
  title: string,
  starter: ReadonlyArray<{ path: string; content: string }>,
): Promise<CampaignProject> {
  const supabase = await createUserClient();

  let { data: project, error } = await supabase.from("projects").select("id").eq("campaign_id", campaignId).maybeSingle();
  if (error) throw new ProjectError("couldn't load the project", { cause: error });
  if (project === null) {
    const created = await supabase.from("projects").insert({ user_id: userId, campaign_id: campaignId, title }).select("id").single();
    // A concurrent first open may have created it already (unique per user + campaign).
    if (created.error?.code === "23505") {
      ({ data: project, error } = await supabase.from("projects").select("id").eq("campaign_id", campaignId).single());
      if (error) throw new ProjectError("couldn't load the project", { cause: error });
    } else if (created.error) {
      throw new ProjectError("couldn't create the project", { cause: created.error });
    } else {
      project = created.data;
    }
  }
  return fillProject(project!.id as string, starter);
}

/** Adds any starter file the project doesn't have yet (never overwriting work), then loads it. */
async function fillProject(projectId: string, starter: ReadonlyArray<{ path: string; content: string }>): Promise<CampaignProject> {
  const supabase = await createUserClient();
  const existing = await supabase.from("project_files").select("path").eq("project_id", projectId);
  if (existing.error) throw new ProjectError("couldn't load project files", { cause: existing.error });
  const present = new Set(existing.data.map((row) => row.path as string));
  for (const file of starter) {
    if (present.has(file.path)) continue;
    const saved = await supabase.rpc("save_project_file", {
      p_project_id: projectId,
      p_path: file.path,
      p_expected_revision: 0,
      p_source: file.content,
      p_mutation_id: crypto.randomUUID(),
    });
    // PT409: another tab added it first — fine, theirs is kept.
    if (saved.error && saved.error.code !== "PT409") throw new ProjectError(`couldn't add ${file.path}`, { cause: saved.error });
  }

  const files = await supabase.from("project_files").select("path, revision, source").eq("project_id", projectId).order("path");
  if (files.error) throw new ProjectError("couldn't load project files", { cause: files.error });
  return { projectId, files: files.data.map((row) => ({ path: row.path as string, revision: Number(row.revision), source: row.source as string })) };
}
