package smoke;

import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class ProcessLimitTest {
    private static final int ATTEMPTS = 1000;

    @Test
    void cannotSpawnUnboundedProcesses() {
        List<Process> started = new ArrayList<>();
        try {
            for (int i = 0; i < ATTEMPTS; i++) {
                started.add(new ProcessBuilder("sleep", "30").start());
            }
        } catch (IOException expected) {
            // The per-user process limit was reached.
        }
        System.out.println("spawned=" + started.size());
        started.forEach(Process::destroyForcibly);
        assertTrue(started.size() < ATTEMPTS, "process limit was not enforced");
    }
}
