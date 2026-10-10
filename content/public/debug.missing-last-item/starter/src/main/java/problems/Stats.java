package problems;

/** Small statistics helpers. */
public final class Stats {
    private Stats() {
    }

    /** The sum of every value. */
    public static long sumAll(int[] values) {
        long total = 0;
        for (int i = 0; i < values.length - 1; i++) {
            total += values[i];
        }
        return total;
    }
}
