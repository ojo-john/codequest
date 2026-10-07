package shop;

/** How a cart's final price is worked out. Callers depend on this interface, never on a concrete pricing class. */
public interface PricingStrategy {
    long totalCents(ShoppingCart cart);

    /** A label for receipts and comparisons; implementations inherit this unless they override it. */
    default String name() {
        return getClass().getSimpleName();
    }
}
