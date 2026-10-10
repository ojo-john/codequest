package problems;

import java.util.HashMap;
import java.util.Map;

/** Finds two different positions whose values add up to a target. */
public final class PairSum {
    private PairSum() {
    }

    public static int[] indicesOf(int[] nums, int target) {
        if (nums == null) {
            throw new IllegalArgumentException("nums is missing");
        }
        Map<Integer, Integer> seenAt = new HashMap<>();
        for (int i = 0; i < nums.length; i++) {
            Integer partner = seenAt.get(target - nums[i]);
            if (partner != null) {
                return new int[] {partner, i};
            }
            seenAt.putIfAbsent(nums[i], i);
        }
        return new int[0];
    }
}
