package smoke;

import java.io.IOException;
import org.junit.jupiter.api.Test;

/** Leaves a process running after the test; cleanup must still tear the environment down. */
class BackgroundProcessTest {
    @Test
    void leavesProcessBehind() throws IOException {
        new ProcessBuilder("sleep", "600").start();
    }
}
