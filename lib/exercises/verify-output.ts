import { normalizeOutput } from "./grade";
import type { ExerciseSetPrivate, PublicQuestion } from "./schema";

/**
 * Builds a JUnit source set that proves every predict-output answer in an exercise set (spec
 * §44: examples are run on the pinned JDK, not trusted by eye). Each program goes in its own
 * package with a test that captures System.out and compares it — normalized exactly like the
 * grader normalizes learner answers — with the canonical answer.
 */

export interface OutputCheck {
  readonly questionId: string;
  readonly testName: string;
}

const NORMALIZE_JAVA = `    private static String normalize(String text) {
        String[] lines = text.replace("\\r\\n", "\\n").replace('\\r', '\\n').split("\\n", -1);
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < lines.length; i++) {
            if (i > 0) out.append('\\n');
            out.append(lines[i].replaceAll("[ \\t]+$", ""));
        }
        return out.toString().replaceAll("\\n+$", "");
    }`;

export function outputVerificationSources(questions: readonly PublicQuestion[], answers: ExerciseSetPrivate["answers"]): { files: Array<{ path: string; content: string }>; checks: OutputCheck[] } {
  const files: Array<{ path: string; content: string }> = [];
  const checks: OutputCheck[] = [];
  questions.forEach((question, index) => {
    const answer = answers[question.id];
    if (question.type !== "predict_output" || answer?.type !== "predict_output") return;
    const pkg = `predict.p${index}`;
    files.push({ path: `predict/p${index}/Main.java`, content: `package ${pkg};\n\n${question.code}` });
    files.push({
      path: `predict/p${index}/OutputTest.java`,
      content: `package ${pkg};

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

class OutputTest {
    @Test
    void printsTheCanonicalAnswer() throws Exception {
        PrintStream original = System.out;
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        System.setOut(new PrintStream(buffer, true, StandardCharsets.UTF_8));
        try {
            Main.main(new String[0]);
        } finally {
            System.setOut(original);
        }
        assertEquals(${JSON.stringify(normalizeOutput(answer.answer))}, normalize(buffer.toString(StandardCharsets.UTF_8)));
    }

${NORMALIZE_JAVA}
}
`,
    });
    checks.push({ questionId: question.id, testName: `${pkg}.OutputTest` });
  });
  return { files, checks };
}
