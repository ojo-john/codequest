package shop;

import java.util.regex.Pattern;

/**
 * Parses order lines typed by shop staff, e.g. {@code "TEA-1, 3"}. Anything that doesn't follow
 * the rules is rejected with an IllegalArgumentException explaining what is wrong.
 */
public final class OrderLineParser {
    public static final int MAX_QUANTITY = 99;
    private static final Pattern SKU = Pattern.compile("[A-Z0-9-]{1,21}");
    private static final Pattern DIGITS = Pattern.compile("[0-9]{1,9}");

    private OrderLineParser() {
    }

    public static OrderLine parse(String line) {
        if (line == null) {
            throw new IllegalArgumentException("order line is missing");
        }
        String[] parts = line.split(",", -1);
        if (parts.length != 2) {
            throw new IllegalArgumentException("expected SKU,QUANTITY but got: " + line);
        }
        String sku = parts[0].trim().toUpperCase();
        if (!SKU.matcher(sku).matches()) {
            throw new IllegalArgumentException("SKU must be 1-20 letters, digits or hyphens: " + parts[0]);
        }
        String quantityText = parts[1].trim();
        if (!DIGITS.matcher(quantityText).matches()) {
            throw new IllegalArgumentException("quantity must be a whole number: " + parts[1]);
        }
        int quantity = Integer.parseInt(quantityText);
        if (quantity < 1 || quantity > MAX_QUANTITY) {
            throw new IllegalArgumentException("quantity must be between 1 and " + MAX_QUANTITY + ": " + quantity);
        }
        return new OrderLine(sku, quantity);
    }
}
