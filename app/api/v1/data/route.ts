import { archiveService } from "@/lib/server/container";
import { deleteRequestSchema } from "@/lib/server/archive-service";
import { handleApi, readJson } from "@/lib/server/http";

/**
 * DELETE /api/v1/data — erase the learner's progress, projects and notes (spec §47, §61, §67). The
 * body must carry the confirmation phrase; the account itself stays so sign-in keeps working.
 */
export async function DELETE(request: Request) {
  return handleApi("data.delete", async ({ user }) => {
    const body = deleteRequestSchema.parse(await readJson(request));
    await archiveService().deleteAllData(user.userId, body.confirm);
    return { deleted: true };
  });
}
