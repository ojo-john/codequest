package smoke;

import java.io.IOException;
import org.junit.jupiter.api.Test;

/**
 * Informational probe: learner code shares a uid with the sandbox's PID 1, so it may be able to
 * end its own sandbox. Records what the platform does; see docs/SECURITY.md.
 */
class KillInitTest {
    @Test
    void signalsInit() throws IOException, InterruptedException {
        int status = new ProcessBuilder("kill", "-KILL", "1").inheritIO().start().waitFor();
        System.out.println("kill-init-status=" + status);
        Thread.sleep(2000);
    }
}
