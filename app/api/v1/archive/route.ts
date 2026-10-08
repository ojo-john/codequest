import { archiveService } from "@/lib/server/container";
import { encodeArchive, readArchiveUpload } from "@/lib/server/archive-codec";
import { handleApi } from "@/lib/server/http";

/** GET /api/v1/archive — download everything the learner owns as a signed JSON archive (spec §47, §68). */
export async function GET() {
  return handleApi("archive.export", async ({ user }) => {
    const archive = await archiveService().exportArchive(user.userId);
    const day = archive.exportedAt.slice(0, 10);
    return new Response(new Uint8Array(encodeArchive(archive)), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-encoding": "gzip",
        "content-disposition": `attachment; filename="codequest-archive-${day}.json"`,
      },
    });
  });
}

/**
 * POST /api/v1/archive — restore an archive (plain JSON, or gzip-compressed JSON). Projects and
 * notes always come back; progress only from an archive this server signed (archive-service).
 */
export async function POST(request: Request) {
  return handleApi("archive.import", async ({ user }) => archiveService().importArchive(user.userId, await readArchiveUpload(request)));
}
