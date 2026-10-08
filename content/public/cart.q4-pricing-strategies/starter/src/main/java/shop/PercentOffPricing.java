package shop;

/**
 * A percentage off the subtotal (1-90%). The discount is rounded down to a whole cent, and
 * shipping is worked out on the discounted amount.
 */
public final class PercentOffPricing implements PricingStrategy {
    private final int percent;

    public PercentOffPricing(int percent) {
        // TODO: reject a percent outside 1-90.
        this.percent = percent;
    }

    @Override
    public long totalCents(ShoppingCart cart) {
        // TODO
        return 0;
    }
}
