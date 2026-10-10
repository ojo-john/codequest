package problems;

/** Merge sort, returning a new sorted array. */
public final class MergeSort {
    private MergeSort() {
    }

    public static int[] sorted(int[] values) {
        int[] copy = values.clone();
        sort(copy, new int[copy.length], 0, copy.length);
        return copy;
    }

    private static void sort(int[] a, int[] buffer, int from, int to) {
        if (to - from < 2) {
            return;
        }
        int mid = (from + to) >>> 1;
        sort(a, buffer, from, mid);
        sort(a, buffer, mid, to);
        int left = from;
        int right = mid;
        for (int i = from; i < to; i++) {
            if (right >= to || (left < mid && a[left] <= a[right])) {
                buffer[i] = a[left++];
            } else {
                buffer[i] = a[right++];
            }
        }
        System.arraycopy(buffer, from, a, from, to - from);
    }
}
