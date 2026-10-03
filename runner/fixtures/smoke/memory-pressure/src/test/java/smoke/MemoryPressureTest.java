package smoke;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class MemoryPressureTest {
    @Test
    void allocatesUntilExhausted() {
        List<byte[]> hog = new ArrayList<>();
        while (true) {
            hog.add(new byte[1 << 20]);
        }
    }
}
