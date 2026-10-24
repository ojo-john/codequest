import type { NextRequest } from "next/server";
import { z } from "zod";
import { flashcardService } from "@/lib/server/container";
import { handleApi } from "@/lib/server/http";

/** DELETE /api/v1/flashcards/:id */
export async function DELETE(_request: NextRequest, context: RouteContext<"/api/v1/flashcards/[id]">) {
  return handleApi("flashcards.delete", async ({ user }) => flashcardService().remove(user.userId, z.uuid().parse((await context.params).id)));
}
