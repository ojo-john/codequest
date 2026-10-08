import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "./canonical-json";
import type { ArchiveSignature, UnsignedArchive } from "./archive-schema";

/**
 * Archive signatures (HMAC-SHA256 with a server-only key). A valid signature proves this server
 * produced the archive and nobody edited it since, which is what allows grading-derived records
 * (XP, mastery, attempts) to be restored: a learner cannot award themselves progress by editing
 * a file (spec §66). An archive is still readable JSON; signing is integrity, not secrecy.
 */

const SIGNING_DOMAIN = "codequest.archive.signature.v1\n";
const KEY_ID_DOMAIN = "codequest.archive.key-id.v1\n";
const MIN_KEY_BYTES = 32;

export interface ArchiveSigningKey {
  readonly id: string;
  readonly secret: Buffer;
}

export type SignatureCheck = "valid" | "missing" | "unknown_key" | "invalid";

const keySchema = z
  .string()
  .regex(/^[A-Za-z0-9+/_-]+={0,2}$/, "must be base64")
  .transform((value) => Buffer.from(value, value.includes("-") || value.includes("_") ? "base64url" : "base64"))
  .refine((bytes) => bytes.length >= MIN_KEY_BYTES, `must decode to at least ${MIN_KEY_BYTES} bytes`);

/**
 * Reads ARCHIVE_SIGNING_KEY (base64, ≥ 32 random bytes: `openssl rand -base64 32`). Returns
 * undefined when unset: exports are then unsigned and imports restore projects only.
 */
export function loadArchiveSigningKey(env: Readonly<Record<string, string | undefined>>): ArchiveSigningKey | undefined {
  const raw = env.ARCHIVE_SIGNING_KEY;
  if (raw === undefined || raw === "") return undefined;
  const secret = keySchema.parse(raw.trim());
  const id = createHash("sha256").update(KEY_ID_DOMAIN).update(secret).digest("hex").slice(0, 16);
  return { id, secret };
}

function mac(key: ArchiveSigningKey, archive: UnsignedArchive): Buffer {
  return createHmac("sha256", key.secret).update(SIGNING_DOMAIN).update(canonicalJson(archive)).digest();
}

export function signArchive(key: ArchiveSigningKey, archive: UnsignedArchive): ArchiveSignature {
  return { alg: "HMAC-SHA256", keyId: key.id, value: mac(key, archive).toString("base64url") };
}

export function checkArchiveSignature(
  key: ArchiveSigningKey | undefined,
  archive: UnsignedArchive,
  signature: ArchiveSignature | null,
): SignatureCheck {
  if (signature === null) return "missing";
  if (key === undefined || signature.keyId !== key.id) return "unknown_key";
  const expected = mac(key, archive);
  const actual = Buffer.from(signature.value, "base64url");
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? "valid" : "invalid";
}
