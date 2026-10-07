package shop;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** The products a customer intends to buy, one line per SKU, in the order first added. */
public final class ShoppingCart {
    // One CartItem per SKU; LinkedHashMap keeps the order lines were first added.
    private final Map<String, CartItem> itemsBySku = new LinkedHashMap<>();

    /** Adds {@code quantity} of the product; adding a SKU already in the cart increases its quantity. */
    public void add(Product product, int quantity) {
        // TODO
    }

    /** How many of this SKU are in the cart (0 if none). */
    public int quantityOf(String sku) {
        // TODO
        return 0;
    }

    /** Total number of units across all lines. */
    public int itemCount() {
        // TODO
        return 0;
    }

    public long subtotalCents() {
        // TODO
        return 0;
    }

    /** The cart's lines, in the order first added. */
    public List<CartItem> items() {
        // TODO
        return List.of();
    }
}
