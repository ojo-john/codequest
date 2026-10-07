package shop;

import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.stream.Collectors;

/** Summaries of cart lines for the shop's purchase reports. */
public final class PurchaseReport {
    private PurchaseReport() {
    }

    /** Category -> total spent on that category (sum of line totals), sorted by category. */
    public static Map<String, Long> totalsByCategory(List<CartItem> items) {
        return items.stream()
                .collect(Collectors.groupingBy(
                        item -> item.product().category(),
                        TreeMap::new,
                        Collectors.summingLong(CartItem::lineTotalCents)));
    }

    /** SKUs whose line total is at least {@code minimumCents}, in alphabetical order. */
    public static List<String> skusWithLineTotalAtLeast(List<CartItem> items, long minimumCents) {
        return items.stream()
                .filter(item -> item.lineTotalCents() >= minimumCents)
                .map(item -> item.product().sku())
                .sorted()
                .toList();
    }

    /** Number of units bought in the given category. */
    public static long unitsInCategory(List<CartItem> items, String category) {
        return items.stream()
                .filter(item -> item.product().category().equals(category))
                .mapToLong(CartItem::quantity)
                .sum();
    }
}
