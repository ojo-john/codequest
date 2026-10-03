package smoke;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

class PrivilegeTest {
    @Test
    void cannotEscalateOrTamperWithHarness() throws InterruptedException {
        int sudoExit;
        try {
            sudoExit = new ProcessBuilder("sudo", "-n", "true").redirectErrorStream(true).start().waitFor();
        } catch (IOException e) {
            sudoExit = -1;
        }
        assertNotEquals(0, sudoExit, "sudo must not succeed for the learner user");
        assertFalse(Files.isWritable(Path.of("/opt/codequest/run.sh")), "harness must be read-only");
        assertFalse(Files.isWritable(Path.of("/opt/codequest/jdk/bin/java")), "JDK must be read-only");
        assertThrows(IOException.class, () -> Files.readAllBytes(Path.of("/etc/shadow")));
    }
}
