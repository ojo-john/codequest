package smoke;

import org.junit.jupiter.api.Test;

/** Exits with the harness's reserved usage code; must not be classified as an infra error. */
class ReservedExitTest {
    @Test
    void exitsWithHarnessReservedCode() {
        System.exit(64);
    }
}
