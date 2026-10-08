import { describe, expect, it } from "vitest";
import { newTestFile, suggestTestClassName } from "@/lib/workspace/test-file";

const MAIN = "src/main/java/shop/OrderLineParser.java";

describe("suggestTestClassName", () => {
  it("suggestTestClassName_mainClass_appendsTest", () => {
    expect(suggestTestClassName(MAIN)).toBe("OrderLineParserTest");
  });

  it("suggestTestClassName_activeFileIsATest_fallsBackToAGenericName", () => {
    expect(suggestTestClassName("src/test/java/shop/OrderLineParserTest.java")).toBe("MyTest");
  });
});

describe("newTestFile", () => {
  it("newTestFile_mainClassActive_usesItsPackageUnderSrcTestJava", () => {
    const file = newTestFile("OrderLineParserTest", MAIN, []);

    expect(file.ok && [file.path, file.source.startsWith("package shop;\n"), file.source.includes("class OrderLineParserTest {")]).toEqual([
      "src/test/java/shop/OrderLineParserTest.java",
      true,
      true,
    ]);
  });

  it("newTestFile_testFileActive_usesTheFallbackMainFilesPackage", () => {
    const file = newTestFile("MoreTest", "src/test/java/shop/OrderLineParserTest.java", [], MAIN);

    expect(file.ok && file.path).toBe("src/test/java/shop/MoreTest.java");
  });

  it("newTestFile_defaultPackage_hasNoPackageLine", () => {
    const file = newTestFile("CartTest", "src/main/java/Cart.java", []);

    expect(file.ok && [file.path, file.source.startsWith("import")]).toEqual(["src/test/java/CartTest.java", true]);
  });

  it("newTestFile_existingPath_isRejected", () => {
    expect(newTestFile("OrderLineParserTest", MAIN, ["src/test/java/shop/OrderLineParserTest.java"]).ok).toBe(false);
  });

  it.each(["orderTest", "Order-Test", "", "Order Test", "1Test", "Évaluation"])("newTestFile_invalidClassName_%s_isRejected", (name) => {
    expect(newTestFile(name, MAIN, []).ok).toBe(false);
  });

  it("newTestFile_surroundingSpaces_areTrimmed", () => {
    const file = newTestFile("  CartTest ", MAIN, []);

    expect(file.ok && file.path).toBe("src/test/java/shop/CartTest.java");
  });
});
