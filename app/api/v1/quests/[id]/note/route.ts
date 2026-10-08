import type { NextRequest } from "next/server";
import { z } from "zod";
import { journalService } from "@/lib/server/container";
import { handleApi, readJson } from "@/lib/server/http";
import { saveNoteSchema } from "@/lib/server/journal-service";

/** PUT /api/v1/quests/:contentVersionId/note — save the learner's note on a quest (empty body deletes it). */
export async function PUT(request: NextRequest, context: RouteContext<"/api/v1/quests/[id]/note">) {
  return handleApi("notes.save", async ({ user }) => {
    const id = z.uuid().parse((await context.params).id);
    return journalService().saveNote(user.userId, id, saveNoteSchema.parse(await readJson(request)));
  });
}
