import type { NextRequest } from "next/server";
import { z } from "zod";
import { flashcardService } from "@/lib/server/container";
import { handleApi, readJson } from "@/lib/server/http";

/** POST /api/v1/flashcards/:id/review — { knewIt } moves the card up a box or back to box 1. */
export async function POST(request: NextRequest, context: RouteContext<"/api/v1/flashcards/[id]/review">) {
  return handleApi("flashcards.review", async ({ user }) => flashcardService().review(user.userId, z.uuid().parse((await context.params).id), await readJson(request)));
}
