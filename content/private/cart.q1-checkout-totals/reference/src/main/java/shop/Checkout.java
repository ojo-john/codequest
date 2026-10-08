package shop;

/**
 * Checkout arithmetic. All money is in cents (integer minor units).
 */
public final class Checkout {
    public static final long FREE_SHIPPING_THRESHOLD_CENTS = 5_000;
    public static final long STANDARD_SHIPPING_CENTS = 499;

    private Checkout() {
    }

    public static long lineTotalCents(long unitPriceCents, int quantity) {
        if (unitPriceCents < 0) {
            throw new IllegalArgumentException("unitPriceCents must not be negative: " + unitPriceCents);
        }
        if (quantity < 1) {
            throw new IllegalArgumentException("quantity must be at least 1: " + quantity);
        }
        return Math.multiplyExact(unitPriceCents, quantity);
    }

    public static long subtotalCents(long[] unitPricesCents, int[] quantities) {
        if (unitPricesCents.length != quantities.length) {
            throw new IllegalArgumentException("every line needs exactly one price and one quantity");
        }
        long subtotal = 0;
        for (int line = 0; line < unitPricesCents.length; line++) {
            subtotal = Math.addExact(subtotal, lineTotalCents(unitPricesCents[line], quantities[line]));
        }
        return subtotal;
    }

    public static long shippingCents(long subtotalCents) {
        if (subtotalCents == 0) {
            return 0;
        }
        return subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS ? 0 : STANDARD_SHIPPING_CENTS;
    }
}
