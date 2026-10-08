package shop;

import java.util.List;
import java.util.Map;

/** Summaries of cart lines for the shop's purchase reports. Write each one as a stream pipeline. */
public final class PurchaseReport {
    private PurchaseReport() {
    }

    /** Category -> total spent on that category (sum of line totals), sorted by category. */
    public static Map<String, Long> totalsByCategory(List<CartItem> items) {
        // TODO
        return Map.of();
    }

    /** SKUs whose line total is at least {@code minimumCents}, in alphabetical order. */
    public static List<String> skusWithLineTotalAtLeast(List<CartItem> items, long minimumCents) {
        // TODO
        return List.of();
    }

    /** Number of units bought in the given category. */
    public static long unitsInCategory(List<CartItem> items, String category) {
        // TODO
        return 0;
    }
}
