import type { NextRequest } from "next/server";
import { z } from "zod";
import { learningService } from "@/lib/server/container";
import { handleApi } from "@/lib/server/http";

/** POST /api/v1/sessions/:id/items/:itemId/complete — finish a practice item (every question answered). */
export async function POST(_request: NextRequest, context: RouteContext<"/api/v1/sessions/[id]/items/[itemId]/complete">) {
  return handleApi("sessions.complete_item", async ({ user }) => {
    const { id, itemId } = await context.params;
    return learningService().completePracticeItem(user.userId, z.uuid().parse(id), z.uuid().parse(itemId));
  });
}
