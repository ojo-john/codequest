package shop;

/**
 * Bulk discount: every line with at least {@code MIN_QUANTITY} units gets {@code PERCENT}% off
 * that line (rounded down to a whole cent). Shipping is worked out on the discounted amount.
 */
public final class BulkDiscountPricing implements PricingStrategy {
    public static final int MIN_QUANTITY = 3;
    public static final int PERCENT = 10;

    @Override
    public long totalCents(ShoppingCart cart) {
        // TODO
        return 0;
    }
}
