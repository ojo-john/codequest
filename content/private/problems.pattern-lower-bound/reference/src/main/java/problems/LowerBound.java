package problems;

/** Binary search for the first position whose value is at least the target. */
public final class LowerBound {
    private LowerBound() {
    }

    public static int firstAtLeast(int[] sorted, int target) {
        if (sorted == null) {
            throw new IllegalArgumentException("sorted is missing");
        }
        int lo = 0;
        int hi = sorted.length;
        while (lo < hi) {
            int mid = lo + (hi - lo) / 2;
            if (sorted[mid] >= target) {
                hi = mid;
            } else {
                lo = mid + 1;
            }
        }
        return lo;
    }
}
