import { engagementService } from "@/lib/server/container";
import { handleApi } from "@/lib/server/http";

/** GET /api/v1/engagement — streak, pauses and achievements (new awards are recorded on read). */
export async function GET() {
  return handleApi("engagement.overview", async ({ user }) => engagementService().overview(user.userId));
}
