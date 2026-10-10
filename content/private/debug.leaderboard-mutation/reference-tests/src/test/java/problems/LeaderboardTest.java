package problems;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

class LeaderboardTest {
    @Test
    void top3LeavesFinishingOrderAlone() {
        Leaderboard board = new Leaderboard(new int[] {5, 9, 1, 7});
        board.top3();
        assertArrayEquals(new int[] {5, 9, 1, 7}, board.scores());
    }
}
