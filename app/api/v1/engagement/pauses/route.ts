import type { NextRequest } from "next/server";
import { z } from "zod";
import { engagementService } from "@/lib/server/container";
import { addPauseSchema } from "@/lib/server/engagement-service";
import { handleApi, readJson } from "@/lib/server/http";

/** POST /api/v1/engagement/pauses — schedule a vacation or busy week (today or later). */
export async function POST(request: NextRequest) {
  return handleApi("engagement.pause_add", async ({ user }) => engagementService().addPause(user.userId, addPauseSchema.parse(await readJson(request))));
}

/** DELETE /api/v1/engagement/pauses?from=YYYY-MM-DD — cancel an upcoming pause or end a running one. */
export async function DELETE(request: NextRequest) {
  return handleApi("engagement.pause_end", async ({ user }) => {
    const from = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(request.nextUrl.searchParams.get("from"));
    return engagementService().endPause(user.userId, from);
  });
}
