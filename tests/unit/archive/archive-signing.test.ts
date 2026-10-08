import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkArchiveSignature, loadArchiveSigningKey, signArchive } from "@/lib/archive/archive-signing";
import { archiveData, unsignedArchive } from "./archive-builders";

const KEY = loadArchiveSigningKey({ ARCHIVE_SIGNING_KEY: Buffer.alloc(32, 7).toString("base64") })!;
const OTHER_KEY = loadArchiveSigningKey({ ARCHIVE_SIGNING_KEY: Buffer.alloc(32, 8).toString("base64") })!;

describe("loadArchiveSigningKey", () => {
  it("loadArchiveSigningKey_unset_returnsUndefined", () => {
    expect(loadArchiveSigningKey({})).toBeUndefined();
  });

  it("loadArchiveSigningKey_shorterThan32Bytes_throws", () => {
    expect(() => loadArchiveSigningKey({ ARCHIVE_SIGNING_KEY: randomBytes(16).toString("base64") })).toThrow(/32 bytes/);
  });

  it("loadArchiveSigningKey_notBase64_throws", () => {
    expect(() => loadArchiveSigningKey({ ARCHIVE_SIGNING_KEY: "not base64 at all!" })).toThrow(/base64/);
  });

  it("loadArchiveSigningKey_base64urlKey_isAccepted", () => {
    expect(loadArchiveSigningKey({ ARCHIVE_SIGNING_KEY: Buffer.alloc(32, 7).toString("base64url") })?.id).toBe(KEY.id);
  });

  it("loadArchiveSigningKey_differentSecrets_haveDifferentKeyIds", () => {
    expect(KEY.id).not.toBe(OTHER_KEY.id);
  });
});

describe("checkArchiveSignature", () => {
  it("checkArchiveSignature_untouchedArchive_isValid", () => {
    const archive = unsignedArchive();

    expect(checkArchiveSignature(KEY, archive, signArchive(KEY, archive))).toBe("valid");
  });

  it("checkArchiveSignature_keysReordered_isStillValid", () => {
    const archive = unsignedArchive();
    const reordered = JSON.parse(JSON.stringify(archive, Object.keys(archive).reverse()));

    expect(checkArchiveSignature(KEY, { ...reordered, data: archive.data }, signArchive(KEY, archive))).toBe("valid");
  });

  it("checkArchiveSignature_xpEdited_isInvalid", () => {
    const archive = unsignedArchive();
    const signature = signArchive(KEY, archive);
    const edited = unsignedArchive({ data: archiveData({ xp_events: [{ event_key: "quest-pass:cart.q1-checkout-totals", delta: 1000, created_at: archive.exportedAt }] }) });

    expect(checkArchiveSignature(KEY, edited, signature)).toBe("invalid");
  });

  it("checkArchiveSignature_subjectChanged_isInvalid", () => {
    const archive = unsignedArchive();

    expect(checkArchiveSignature(KEY, { ...archive, subject: "99999999-9999-4999-8999-999999999999" }, signArchive(KEY, archive))).toBe("invalid");
  });

  it("checkArchiveSignature_noSignature_isMissing", () => {
    expect(checkArchiveSignature(KEY, unsignedArchive(), null)).toBe("missing");
  });

  it("checkArchiveSignature_signedWithAnotherKey_isUnknownKey", () => {
    const archive = unsignedArchive();

    expect(checkArchiveSignature(KEY, archive, signArchive(OTHER_KEY, archive))).toBe("unknown_key");
  });

  it("checkArchiveSignature_serverHasNoKey_isUnknownKey", () => {
    const archive = unsignedArchive();

    expect(checkArchiveSignature(undefined, archive, signArchive(KEY, archive))).toBe("unknown_key");
  });

  it("checkArchiveSignature_forgedValueWithRightKeyId_isInvalid", () => {
    const archive = unsignedArchive();

    expect(checkArchiveSignature(KEY, archive, { alg: "HMAC-SHA256", keyId: KEY.id, value: "A".repeat(43) })).toBe("invalid");
  });
});
