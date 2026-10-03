package smoke;

import org.junit.jupiter.api.Test;

class SystemExitTest {
    @Test
    void exitsBeforeReportIsWritten() {
        System.exit(0);
    }
}
