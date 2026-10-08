package shop;

/**
 * Checkout arithmetic. All money is in cents (integer minor units).
 */
public final class Checkout {
    public static final long FREE_SHIPPING_THRESHOLD_CENTS = 5_000;
    public static final long STANDARD_SHIPPING_CENTS = 499;

    private Checkout() {
    }

    /**
     * Unit price times quantity.
     *
     * @throws IllegalArgumentException if the price is negative or the quantity is below 1
     * @throws ArithmeticException if the total does not fit in a long
     */
    public static long lineTotalCents(long unitPriceCents, int quantity) {
        // TODO: validate both arguments, then return the exact line total.
        return 0;
    }

    /**
     * Sum of every line; line i is unitPricesCents[i] times quantities[i].
     *
     * @throws IllegalArgumentException if the arrays have different lengths or any line is invalid
     */
    public static long subtotalCents(long[] unitPricesCents, int[] quantities) {
        // TODO: check the lengths match, then add up lineTotalCents for every line.
        return 0;
    }

    /**
     * Shipping fee for a cart with this subtotal: free for an empty cart or at/above the
     * free-shipping threshold, otherwise the standard fee.
     */
    public static long shippingCents(long subtotalCents) {
        // TODO
        return 0;
    }
}
