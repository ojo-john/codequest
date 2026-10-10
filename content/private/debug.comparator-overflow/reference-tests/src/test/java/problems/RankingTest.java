package problems;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

class RankingTest {
    @Test
    void extremeScoresRankCorrectly() {
        assertArrayEquals(new String[] {"high", "low"}, Ranking.byScore(new String[] {"low", "high"}, new int[] {Integer.MIN_VALUE, Integer.MAX_VALUE}));
    }
}
