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
        Arrays.sort(scores);
        int count = Math.min(3, scores.length);
        int[] best = new int[count];
        for (int i = 0; i < count; i++) {
            best[i] = scores[scores.length - 1 - i];
        }
        return best;
    }
}
