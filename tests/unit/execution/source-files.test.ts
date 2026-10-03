import { describe, expect, it } from "vitest";
import { validateSourceFiles, type SourceFile } from "@/lib/execution/source-files";

const LIMITS = { maxSourceFiles: 3, maxTotalSourceBytes: 100 };

function file(path: string, content = "class A {}"): SourceFile {
  return { path, content };
}

function issueCodes(files: SourceFile[]): string[] {
  const result = validateSourceFiles(files, LIMITS);
  return result.ok ? [] : result.issues.map((issue) => issue.code);
}

describe("validateSourceFiles", () => {
  it("validateSourceFiles_emptySet_rejectsAsEmpty", () => {
    expect(issueCodes([])).toEqual(["empty_source_set"]);
  });

  it.each([
    ["../Escape.java", "parent traversal"],
    ["src/../../Escape.java", "nested traversal"],
    ["./Main.java", "dot segment"],
    ["/etc/Passwd.java", "absolute path"],
    ["src\\Main.java", "backslash"],
    ["src//Main.java", "empty segment"],
    ["Main.java\0.txt", "NUL byte"],
    ["Main.txt", "non-java extension"],
    ["Main.JAVA", "wrong-case extension"],
    ["1Main.java", "file name not a Java identifier"],
    ["my dir/Main.java", "space in directory"],
    ["src/$(rm -rf)/Main.java", "shell metacharacters"],
    ["src/Maïn.java", "non-ASCII name"],
    [".hidden/Main.java", "hidden directory"],
    ["", "empty path"],
  ])("validateSourceFiles_path %j (%s)_rejectsInvalidPath", (path) => {
    expect(issueCodes([file(path)])).toContain("invalid_path");
  });

  it("validateSourceFiles_tooDeep_rejectsInvalidPath", () => {
    expect(issueCodes([file(`${"a/".repeat(12)}Main.java`)])).toContain("invalid_path");
  });

  it("validateSourceFiles_moreFilesThanLimit_rejectsTooManyFiles", () => {
    expect(issueCodes([file("A.java"), file("B.java"), file("C.java"), file("D.java")])).toContain("too_many_files");
  });

  it("validateSourceFiles_exactlyAtFileLimit_accepts", () => {
    expect(validateSourceFiles([file("A.java"), file("B.java"), file("C.java")], LIMITS).ok).toBe(true);
  });

  it("validateSourceFiles_totalBytesOverLimit_rejectsCountingUtf8Bytes", () => {
    // 50 two-byte characters = 100 bytes, plus one more byte in the second file.
    expect(issueCodes([file("A.java", "é".repeat(50)), file("B.java", "x")])).toContain("total_size_exceeded");
  });

  it("validateSourceFiles_totalBytesExactlyAtLimit_accepts", () => {
    expect(validateSourceFiles([file("A.java", "x".repeat(100))], LIMITS).ok).toBe(true);
  });

  it("validateSourceFiles_pathsDifferingOnlyByCase_rejectsDuplicate", () => {
    expect(issueCodes([file("shop/Cart.java"), file("shop/cart.java")])).toContain("duplicate_path");
  });

  it("validateSourceFiles_nulInContent_rejectsInvalidContent", () => {
    expect(issueCodes([file("A.java", "class A {}\0")])).toContain("invalid_content");
  });

  it("validateSourceFiles_multipleProblems_reportsAllIssues", () => {
    expect(issueCodes([file("../A.java"), file("../A.java")])).toEqual(["invalid_path", "invalid_path", "duplicate_path"]);
  });

  it("validateSourceFiles_validPackagedSources_returnsFrozenCopy", () => {
    const input = [file("src/main/java/shop/Cart.java"), file("src/test/java/shop/Cart_Test.java")];

    const result = validateSourceFiles(input, { maxSourceFiles: 20, maxTotalSourceBytes: 1000 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files).toEqual(input);
    expect(result.files).not.toBe(input);
    expect(Object.isFrozen(result.files)).toBe(true);
  });
});
