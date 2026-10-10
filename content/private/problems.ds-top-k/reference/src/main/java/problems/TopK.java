package problems;

import java.util.PriorityQueue;

/** The k largest values, largest first. */
public final class TopK {
    private TopK() {
    }

    public static int[] largest(int[] values, int k) {
        if (values == null || k < 0 || k > values.length) {
            throw new IllegalArgumentException("k must be between 0 and the number of values");
        }
        PriorityQueue<Integer> smallestOfTop = new PriorityQueue<>();
        for (int value : values) {
            smallestOfTop.offer(value);
            if (smallestOfTop.size() > k) {
                smallestOfTop.poll();
            }
        }
        int[] result = new int[k];
        for (int i = k - 1; i >= 0; i--) {
            result[i] = smallestOfTop.poll();
        }
        return result;
    }
}
