package shop;

/**
 * Parses order lines typed by shop staff, e.g. {@code "TEA-1, 3"}. Anything that doesn't follow
 * the rules is rejected with an IllegalArgumentException explaining what is wrong.
 */
public final class OrderLineParser {
    public static final int MAX_QUANTITY = 99;

    private OrderLineParser() {
    }

    public static OrderLine parse(String line) {
        throw new UnsupportedOperationException("TODO");
    }
}
