import { describe, expect, it } from "vitest";
import { classifySave, reconcileDraft, retryDelayMs, stillDirty } from "@/lib/workspace/sync-rules";

describe("reconcileDraft", () => {
  it("reconcileDraft_serverMovedOnAndDraftDiffers_isAConflictNotAnOverwrite", () => {
    expect(reconcileDraft({ source: "from laptop", revision: 3 }, { source: "from phone", baseRevision: 2 })).toEqual({
      kind: "conflict",
      local: "from phone",
      server: { source: "from laptop", revision: 3 },
    });
  });

  it("reconcileDraft_draftOnCurrentRevision_isRestored", () => {
    expect(reconcileDraft({ source: "saved", revision: 2 }, { source: "unsaved edit", baseRevision: 2 })).toEqual({ kind: "restore", source: "unsaved edit" });
  });

  it("reconcileDraft_draftMatchesServer_isDiscarded", () => {
    expect(reconcileDraft({ source: "same", revision: 5 }, { source: "same", baseRevision: 2 })).toEqual({ kind: "discard" });
  });

  it("reconcileDraft_fileNeverReachedServer_isRestored", () => {
    expect(reconcileDraft(undefined, { source: "new file", baseRevision: 0 })).toEqual({ kind: "restore", source: "new file" });
  });

  it("reconcileDraft_fileMissingOnServerAfterDraft_keepsLocalWork", () => {
    expect(reconcileDraft(undefined, { source: "edited", baseRevision: 4 }).kind).toBe("restore");
  });

  it("reconcileDraft_serverBehindDraftBase_keepsLocalWork", () => {
    expect(reconcileDraft({ source: "old", revision: 1 }, { source: "newer", baseRevision: 3 })).toEqual({ kind: "restore", source: "newer" });
  });
});

describe("classifySave", () => {
  it("classifySave_staleRevision_isConflict", () => {
    expect(classifySave({ data: null, error: { code: "PT409" } })).toEqual({ kind: "conflict" });
  });

  it.each([{ code: "" }, {}, { code: "54000" }, { code: "42501" }])("classifySave_otherError %j_isRetry", (error) => {
    expect(classifySave({ data: null, error })).toEqual({ kind: "retry" });
  });

  it("classifySave_success_returnsNewRevision", () => {
    expect(classifySave({ data: 7, error: null })).toEqual({ kind: "saved", revision: 7 });
  });
});

describe("stillDirty and retryDelayMs", () => {
  it("stillDirty_typedDuringSave_isTrue", () => {
    expect(stillDirty("abc", "ab")).toBe(true);
  });

  it("retryDelayMs_grows_andIsCappedAt30s", () => {
    expect([retryDelayMs(0, () => 1), retryDelayMs(3, () => 1), retryDelayMs(20, () => 1)]).toEqual([1000, 8000, 30000]);
  });

  it("retryDelayMs_jitter_staysWithinHalfToFull", () => {
    expect([retryDelayMs(2, () => 0), retryDelayMs(2, () => 0.999)]).toEqual([2000, 3998]);
  });
});
