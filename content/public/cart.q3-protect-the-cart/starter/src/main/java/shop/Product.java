package shop;

/** Something the shop sells. Prices are in cents. */
// TODO (quest 3: reject a blank sku/name/category and a negative price)
public class Product {
    private final String sku;
    private final String name;
    private final String category;
    private final long priceCents;

    public Product(String sku, String name, String category, long priceCents) {
        this.sku = sku;
        this.name = name;
        this.category = category;
        this.priceCents = priceCents;
    }

    public String sku() {
        return sku;
    }

    public String name() {
        return name;
    }

    public String category() {
        return category;
    }

    public long priceCents() {
        return priceCents;
    }
}
