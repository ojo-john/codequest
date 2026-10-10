package problems;

/** Averages of int values. */
public final class Averages {
    private Averages() {
    }

    /** The mean of the values; an empty array is rejected. */
    public static double mean(int[] values) {
        if (values.length == 0) {
            throw new IllegalArgumentException("no values");
        }
        long total = 0;
        for (int value : values) {
            total += value;
        }
        return (double) total / values.length;
    }
}
