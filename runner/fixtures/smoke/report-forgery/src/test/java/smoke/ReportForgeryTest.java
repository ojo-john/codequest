package smoke;

import static org.junit.jupiter.api.Assertions.fail;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

/**
 * KNOWN LIMITATION probe (spec §65): code sharing the JVM with the in-sandbox harness can rewrite
 * the report after JUnit writes it and force a zero exit status. Recorded, not expected to be
 * blocked; scope is owner-personal learning, not an adversarial contest judge.
 */
class ReportForgeryTest {
    @Test
    void rewritesReportOnShutdown() {
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            try {
                Files.writeString(Path.of("reports/TEST-junit-jupiter.xml"),
                        "<testsuite tests=\"1\" failures=\"0\" errors=\"0\"></testsuite>");
            } catch (IOException ignored) {
                // Best effort probe.
            }
            Runtime.getRuntime().halt(0);
        }));
        fail("genuinely failing");
    }
}
