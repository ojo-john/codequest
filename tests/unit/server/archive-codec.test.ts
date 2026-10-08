import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ARCHIVE_TRANSFER_LIMITS, readArchiveUpload } from "@/lib/server/archive-codec";
import { ApiError } from "@/lib/server/http";

function upload(body: Uint8Array | string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/v1/archive", { method: "POST", body: typeof body === "string" ? body : new Blob([new Uint8Array(body)]), headers });
}

async function apiError(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.catch((caught: unknown) => caught);
  if (!(error instanceof ApiError)) throw new Error(`expected ApiError, got ${String(error)}`);
  return error;
}

describe("readArchiveUpload", () => {
  it("readArchiveUpload_plainJson_parses", async () => {
    expect(await readArchiveUpload(upload('{"a":1}'))).toEqual({ a: 1 });
  });

  it("readArchiveUpload_gzipJson_decompressesAndParses", async () => {
    expect(await readArchiveUpload(upload(new Uint8Array(gzipSync('{"a":[1,2]}'))))).toEqual({ a: [1, 2] });
  });

  it("readArchiveUpload_empty_rejects400", async () => {
    expect((await apiError(readArchiveUpload(upload("")))).code).toBe("empty_upload");
  });

  it("readArchiveUpload_invalidJson_rejects400", async () => {
    expect((await apiError(readArchiveUpload(upload("{not json")))).code).toBe("invalid_json");
  });

  it("readArchiveUpload_corruptGzip_rejects400", async () => {
    expect((await apiError(readArchiveUpload(upload(new Uint8Array([0x1f, 0x8b, 1, 2, 3]))))).code).toBe("invalid_upload");
  });

  it("readArchiveUpload_declaredLengthOverLimit_rejects413", async () => {
    const request = upload("{}", { "content-length": String(ARCHIVE_TRANSFER_LIMITS.maxTransferBytes + 1) });

    expect((await apiError(readArchiveUpload(request))).status).toBe(413);
  });

  it("readArchiveUpload_bodyOverLimit_rejects413", async () => {
    expect((await apiError(readArchiveUpload(upload(new Uint8Array(ARCHIVE_TRANSFER_LIMITS.maxTransferBytes + 1))))).status).toBe(413);
  });

  it("readArchiveUpload_decompressionBomb_rejects413", async () => {
    const bomb = new Uint8Array(gzipSync(Buffer.alloc(ARCHIVE_TRANSFER_LIMITS.maxJsonBytes + 1, 0x20)));

    expect((await apiError(readArchiveUpload(upload(bomb)))).status).toBe(413);
  });
});
