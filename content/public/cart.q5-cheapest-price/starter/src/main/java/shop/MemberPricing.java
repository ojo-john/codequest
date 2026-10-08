package shop;

/** Members pay the subtotal and never pay for shipping. */
public final class MemberPricing implements PricingStrategy {
    @Override
    public long totalCents(ShoppingCart cart) {
        // TODO
        return 0;
    }
}
