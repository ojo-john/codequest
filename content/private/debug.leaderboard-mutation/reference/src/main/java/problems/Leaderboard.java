package problems;

import java.util.Arrays;

/** Scores in the order players finished. */
public final class Leaderboard {
    private final int[] scores;

    public Leaderboard(int[] scores) {
        this.scores = scores.clone();
    }

    /** Scores in finishing order. */
    public int[] scores() {
        return scores.clone();
    }

    /** The three highest scores, highest first (fewer if there are fewer players). */
    public int[] top3() {
        int[] sorted = scores.clone();
        Arrays.sort(sorted);
        int count = Math.min(3, sorted.length);
        int[] best = new int[count];
        for (int i = 0; i < count; i++) {
            best[i] = sorted[sorted.length - 1 - i];
        }
        return best;
    }
}
