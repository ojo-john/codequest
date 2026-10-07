package shop;

/**
 * A percentage off the subtotal (1-90%). The discount is rounded down to a whole cent, and
 * shipping is worked out on the discounted amount.
 */
public final class PercentOffPricing implements PricingStrategy {
    private final int percent;

    public PercentOffPricing(int percent) {
        if (percent < 1 || percent > 90) {
            throw new IllegalArgumentException("percent must be between 1 and 90: " + percent);
        }
        this.percent = percent;
    }

    @Override
    public long totalCents(ShoppingCart cart) {
        long subtotal = cart.subtotalCents();
        long discount = Math.multiplyExact(subtotal, percent) / 100;
        long discounted = subtotal - discount;
        return Math.addExact(discounted, Checkout.shippingCents(discounted));
    }
}
