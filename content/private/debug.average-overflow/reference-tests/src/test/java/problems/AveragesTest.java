package problems;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

class AveragesTest {
    @Test
    void largeValuesDontOverflow() {
        assertEquals(2147483647.0, Averages.mean(new int[] {Integer.MAX_VALUE, Integer.MAX_VALUE}));
    }
}
