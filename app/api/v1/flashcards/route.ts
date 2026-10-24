import type { NextRequest } from "next/server";
import { flashcardService } from "@/lib/server/container";
import { handleApi, readJson } from "@/lib/server/http";

/** GET /api/v1/flashcards — the learner's cards, due ones first. */
export async function GET() {
  return handleApi("flashcards.list", async ({ user }) => flashcardService().overview(user.userId));
}

/** POST /api/v1/flashcards — make a card from a note, in the learner's own words. */
export async function POST(request: NextRequest) {
  return handleApi("flashcards.create", async ({ user }) => flashcardService().create(user.userId, await readJson(request)));
}
