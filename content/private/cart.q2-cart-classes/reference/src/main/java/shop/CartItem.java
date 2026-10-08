package shop;

/** One line of a cart: a product and how many of it. */
public final class CartItem {
    private final Product product;
    private final int quantity;

    public CartItem(Product product, int quantity) {
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
