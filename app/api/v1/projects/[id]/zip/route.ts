import type { NextRequest } from "next/server";
import { z } from "zod";
import { archiveService } from "@/lib/server/container";
import { handleApi } from "@/lib/server/http";

/** GET /api/v1/projects/:id/zip — the project's Java sources as a ZIP (spec §47). */
export async function GET(_request: NextRequest, context: RouteContext<"/api/v1/projects/[id]/zip">) {
  return handleApi("projects.zip", async ({ user }) => {
    const id = z.uuid().parse((await context.params).id);
    const zip = await archiveService().projectZip(user.userId, id);
    return new Response(new Uint8Array(zip.bytes), {
      headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${zip.fileName}"` },
    });
  });
}
