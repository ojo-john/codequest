import "server-only";
import { gunzipSync, gzipSync } from "node:zlib";
import type { Archive } from "@/lib/archive/archive-schema";
import { ApiError } from "./http";

/**
 * Archive bytes on the wire. Vercel Functions cap request and response bodies at 4.5 MB, so
 * archives travel gzip-compressed both ways (Java source compresses ~5–10×); the file a learner
 * saves is plain, indented JSON. Both directions are bounded so a hostile upload (or a
 * decompression bomb) can't exhaust the function's memory.
 */

export const ARCHIVE_TRANSFER_LIMITS = {
  /** Compressed bytes, under Vercel's 4.5 MB body limit. */
  maxTransferBytes: 4 * 1024 * 1024,
  /** Decompressed JSON. */
  maxJsonBytes: 64 * 1024 * 1024,
} as const;

const GZIP_MAGIC = [0x1f, 0x8b] as const;

export function encodeArchive(archive: Archive): Buffer {
  const compressed = gzipSync(JSON.stringify(archive, null, 2));
  if (compressed.length > ARCHIVE_TRANSFER_LIMITS.maxTransferBytes) {
    throw new ApiError(507, "archive_too_large", "Your archive is larger than a single download allows. Download projects as ZIPs instead, and ask the owner to run a database backup.");
  }
  return compressed;
}

function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1];
}

/** Reads an upload that is either gzip-compressed or plain JSON. */
export async function readArchiveUpload(request: Request): Promise<unknown> {
  const { maxTransferBytes, maxJsonBytes } = ARCHIVE_TRANSFER_LIMITS;
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxTransferBytes) throw tooLarge();
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length === 0) throw new ApiError(400, "empty_upload", "The upload was empty.");
  if (bytes.length > maxTransferBytes) throw tooLarge();

  let json: Buffer;
  if (isGzip(bytes)) {
    try {
      json = gunzipSync(bytes, { maxOutputLength: maxJsonBytes });
    } catch (error) {
      if (error instanceof RangeError) throw tooLarge();
      throw new ApiError(400, "invalid_upload", "The upload isn't valid gzip data.");
    }
  } else {
    json = Buffer.from(bytes);
  }
  try {
    return JSON.parse(json.toString("utf8"));
  } catch {
    throw new ApiError(400, "invalid_json", "This file isn't valid JSON.");
  }
}

function tooLarge(): ApiError {
  return new ApiError(413, "upload_too_large", "This file is too large to import.");
}
