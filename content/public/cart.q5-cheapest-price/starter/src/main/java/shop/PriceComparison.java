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
        throw new UnsupportedOperationException("TODO");
    }
}
