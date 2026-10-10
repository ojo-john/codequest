import { describe, expect, it } from "vitest";
import { designPath, isDesignDocument } from "@/lib/exercises/design";

describe("design documents", () => {
  it("designPath_isADesignDocument", () => {
    expect(isDesignDocument(designPath("data-model"))).toBe(true);
  });

  it.each(["design/../secret.md", "design/Api.md", "notes/api.md", "design/api.java", "design/api.md.java", "design/sub/api.md", "Main.java"])("isDesignDocument_%s_isFalse", (path) => {
    expect(isDesignDocument(path)).toBe(false);
  });
});
