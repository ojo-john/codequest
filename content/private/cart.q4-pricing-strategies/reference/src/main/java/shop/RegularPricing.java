package shop;

/** Everyday prices: the subtotal plus standard shipping rules. */
public final class RegularPricing implements PricingStrategy {
    @Override
    public long totalCents(ShoppingCart cart) {
        long subtotal = cart.subtotalCents();
        return Math.addExact(subtotal, Checkout.shippingCents(subtotal));
    }
}
