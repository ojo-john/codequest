import { LEARNER_TEST_ROOT } from "@/lib/execution/test-quality";

/**
 * Creating a learner test file (spec §12 custom tests, §19): JUnit 5, in the same package as the
 * class it tests, under src/test/java so the runner treats it as the learner's own test.
 */

const MAIN_ROOT = "src/main/java/";
const CLASS_NAME = /^[A-Z][A-Za-z0-9_]{0,59}$/;

export type NewTestFile = { readonly ok: true; readonly path: string; readonly source: string } | { readonly ok: false; readonly message: string };

function packageDir(mainPath: string): string {
  const relative = mainPath.startsWith(MAIN_ROOT) ? mainPath.slice(MAIN_ROOT.length) : "";
  const slash = relative.lastIndexOf("/");
  return slash === -1 ? "" : relative.slice(0, slash);
}

/** "src/main/java/shop/OrderLineParser.java" -> "OrderLineParserTest"; a test file suggests a fresh name. */
export function suggestTestClassName(activePath: string): string {
  const base = activePath.split("/").pop()?.replace(/\.java$/, "") ?? "";
  if (!activePath.startsWith(MAIN_ROOT) || !CLASS_NAME.test(base)) return "MyTest";
  return `${base}Test`;
}

export function newTestFile(className: string, activePath: string, existingPaths: readonly string[], fallbackMainPath?: string): NewTestFile {
  const name = className.trim();
  if (!CLASS_NAME.test(name)) return { ok: false, message: "Use a Java class name starting with a capital letter, e.g. OrderLineParserTest." };
  const mainPath = activePath.startsWith(MAIN_ROOT) ? activePath : (fallbackMainPath ?? "");
  const dir = packageDir(mainPath);
  const path = `${LEARNER_TEST_ROOT}${dir === "" ? "" : `${dir}/`}${name}.java`;
  if (existingPaths.includes(path)) return { ok: false, message: `${name}.java already exists.` };
  const packageLine = dir === "" ? "" : `package ${dir.replaceAll("/", ".")};\n\n`;
  const source = `${packageLine}import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

class ${name} {

    @Test
    void describeWhatShouldHappen() {
        // Arrange, act, assert. For example:
        // assertEquals(expected, actual);
        // assertThrows(IllegalArgumentException.class, () -> ...);
    }
}
`;
  return { ok: true, path, source };
}
