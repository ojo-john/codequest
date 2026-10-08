package shop;

/** One line of a cart: a product and how many of it. */
// TODO (quest 3: reject a missing product and a quantity below 1)
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
