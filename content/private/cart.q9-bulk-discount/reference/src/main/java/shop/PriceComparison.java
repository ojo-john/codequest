package shop;

import java.util.List;

/** Finds the best deal for a cart without knowing which pricing classes exist. */
public final class PriceComparison {
    private PriceComparison() {
    }

    /**
     * The strategy giving the lowest total; on a tie, the one listed first.
     *
     * @throws IllegalArgumentException if no strategies are given
     */
    public static PricingStrategy cheapest(ShoppingCart cart, List<PricingStrategy> strategies) {
        if (strategies == null || strategies.isEmpty()) {
            throw new IllegalArgumentException("at least one pricing strategy is required");
        }
        PricingStrategy best = null;
        long bestTotal = Long.MAX_VALUE;
        for (PricingStrategy strategy : strategies) {
            long total = strategy.totalCents(cart);
            if (total < bestTotal) {
                best = strategy;
                bestTotal = total;
            }
        }
        return best;
    }
}
