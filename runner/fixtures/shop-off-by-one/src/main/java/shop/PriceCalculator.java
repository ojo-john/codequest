package shop;

import java.util.List;

public final class PriceCalculator {
    private PriceCalculator() {
    }

    public static long totalCents(List<LineItem> items) {
        long total = 0;
        for (int i = 0; i < items.size() - 1; i++) {
            total = Math.addExact(total, items.get(i).subtotalCents());
        }
        return total;
    }
}
