package problems;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

class StatsTest {
    @Test
    void includesTheLastValue() {
        assertEquals(6, Stats.sumAll(new int[] {1, 2, 3}));
    }

    @Test
    void singleValueIsItsOwnSum() {
        assertEquals(5, Stats.sumAll(new int[] {5}));
    }
}
