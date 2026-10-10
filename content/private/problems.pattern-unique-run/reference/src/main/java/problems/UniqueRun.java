package problems;

import java.util.HashMap;
import java.util.Map;

/** Length of the longest substring with no repeated characters. */
public final class UniqueRun {
    private UniqueRun() {
    }

    public static int longest(String text) {
        if (text == null) {
            throw new IllegalArgumentException("text is missing");
        }
        Map<Character, Integer> lastSeen = new HashMap<>();
        int best = 0;
        int left = 0;
        for (int right = 0; right < text.length(); right++) {
            Integer previous = lastSeen.put(text.charAt(right), right);
            if (previous != null && previous >= left) {
                left = previous + 1;
            }
            best = Math.max(best, right - left + 1);
        }
        return best;
    }
}
