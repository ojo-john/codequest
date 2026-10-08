package shop;

/** One line of a cart: a product and how many of it (at least one). Immutable. */
public final class CartItem {
    private final Product product;
    private final int quantity;

    public CartItem(Product product, int quantity) {
        if (product == null) {
            throw new IllegalArgumentException("product is required");
        }
        if (quantity < 1) {
            throw new IllegalArgumentException("quantity must be at least 1: " + quantity);
        }
        this.product = product;
        this.quantity = quantity;
    }

    public Product product() {
        return product;
    }

    public int quantity() {
        return quantity;
    }

    public long lineTotalCents() {
        return Checkout.lineTotalCents(product.priceCents(), quantity);
    }
}
