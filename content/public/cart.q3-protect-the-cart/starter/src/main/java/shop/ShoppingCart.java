package shop;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** The products a customer intends to buy, one line per SKU, in the order first added. */
// TODO (quest 3: validate add(), make items() read-only, add changeQuantity/remove/isEmpty)
public final class ShoppingCart {
    private final Map<String, CartItem> itemsBySku = new LinkedHashMap<>();

    /** Adds {@code quantity} of the product; adding a SKU already in the cart increases its quantity. */
    public void add(Product product, int quantity) {
        CartItem existing = itemsBySku.get(product.sku());
        int newQuantity = existing == null ? quantity : existing.quantity() + quantity;
        itemsBySku.put(product.sku(), new CartItem(product, newQuantity));
    }

    /** How many of this SKU are in the cart (0 if none). */
    public int quantityOf(String sku) {
        CartItem item = itemsBySku.get(sku);
        return item == null ? 0 : item.quantity();
    }

    /** Total number of units across all lines. */
    public int itemCount() {
        int count = 0;
        for (CartItem item : itemsBySku.values()) {
            count += item.quantity();
        }
        return count;
    }

    public long subtotalCents() {
        long subtotal = 0;
        for (CartItem item : itemsBySku.values()) {
            subtotal = Math.addExact(subtotal, item.lineTotalCents());
        }
        return subtotal;
    }

    /** Sets the quantity of a SKU already in the cart; 0 removes the line. */
    public void changeQuantity(String sku, int quantity) {
        throw new UnsupportedOperationException("TODO");
    }

    /** Removes a SKU; returns whether it was in the cart. */
    public boolean remove(String sku) {
        throw new UnsupportedOperationException("TODO");
    }

    public boolean isEmpty() {
        throw new UnsupportedOperationException("TODO");
    }

    public List<CartItem> items() {
        return new ArrayList<>(itemsBySku.values());
    }
}
