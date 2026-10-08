package shop;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The products a customer intends to buy, one line per SKU, in the order first added.
 * Invariants: every line has a quantity of at least 1, and nothing outside this class can
 * change the lines except through its methods.
 */
public final class ShoppingCart {
    private final Map<String, CartItem> itemsBySku = new LinkedHashMap<>();

    /** Adds {@code quantity} of the product; adding a SKU already in the cart increases its quantity. */
    public void add(Product product, int quantity) {
        if (product == null) {
            throw new IllegalArgumentException("product is required");
        }
        if (quantity < 1) {
            throw new IllegalArgumentException("quantity must be at least 1: " + quantity);
        }
        CartItem existing = itemsBySku.get(product.sku());
        int newQuantity = existing == null ? quantity : Math.addExact(existing.quantity(), quantity);
        itemsBySku.put(product.sku(), new CartItem(product, newQuantity));
    }

    /** Sets the quantity of a SKU already in the cart; 0 removes the line. */
    public void changeQuantity(String sku, int quantity) {
        CartItem existing = itemsBySku.get(sku);
        if (existing == null) {
            throw new IllegalArgumentException("not in the cart: " + sku);
        }
        if (quantity < 0) {
            throw new IllegalArgumentException("quantity must not be negative: " + quantity);
        }
        if (quantity == 0) {
            itemsBySku.remove(sku);
        } else {
            itemsBySku.put(sku, new CartItem(existing.product(), quantity));
        }
    }

    /** Removes a SKU; returns whether it was in the cart. */
    public boolean remove(String sku) {
        return itemsBySku.remove(sku) != null;
    }

    public boolean isEmpty() {
        return itemsBySku.isEmpty();
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

    /** The price under the given pricing rules; the cart doesn't know which rules they are. */
    public long totalCents(PricingStrategy pricing) {
        if (pricing == null) {
            throw new IllegalArgumentException("pricing is required");
        }
        return pricing.totalCents(this);
    }

    /** A read-only snapshot of the lines; callers can't change the cart through it. */
    public List<CartItem> items() {
        return List.copyOf(itemsBySku.values());
    }
}
