import type { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, handleApi, readJson } from "@/lib/server/http";
import { createUserClient } from "@/lib/supabase/server";

const preferencesSchema = z.object({ showUnreviewedContent: z.boolean() }).strict();

/** PATCH /api/v1/preferences — the learner's own settings, written as the learner (RLS applies). */
export async function PATCH(request: NextRequest) {
  return handleApi("preferences.update", async ({ user }) => {
    const body = preferencesSchema.parse(await readJson(request));
    const supabase = await createUserClient();
    const { data, error } = await supabase.from("profiles").select("settings").eq("user_id", user.userId).single();
    if (error) throw new ApiError(503, "store_unavailable", "Couldn't load your settings.");
    const settings = { ...(data.settings as Record<string, unknown>), show_unreviewed_content: body.showUnreviewedContent };
    const update = await supabase.from("profiles").update({ settings }).eq("user_id", user.userId);
    if (update.error) throw new ApiError(503, "store_unavailable", "Couldn't save your settings.");
    return { showUnreviewedContent: body.showUnreviewedContent };
  });
}
