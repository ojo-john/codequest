package smoke;

import org.junit.jupiter.api.Test;

class InfiniteLoopTest {
    @Test
    void spinsForever() {
        while (true) {
            Thread.onSpinWait();
        }
    }
}
