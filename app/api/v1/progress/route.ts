import { handleApi } from "@/lib/server/http";
import { learningService } from "@/lib/server/container";

/** GET /api/v1/progress — XP, campaign completion and per-skill estimates (with mastery state). */
export async function GET() {
  return handleApi("progress.get", async ({ user }) => learningService().getProgress(user.userId));
}
