package shop;

/** Something the shop sells. Prices are in cents. A Product is always valid once constructed. */
public class Product {
    private final String sku;
    private final String name;
    private final String category;
    private final long priceCents;

    public Product(String sku, String name, String category, long priceCents) {
        this.sku = requireText(sku, "sku");
        this.name = requireText(name, "name");
        this.category = requireText(category, "category");
        if (priceCents < 0) {
            throw new IllegalArgumentException("priceCents must not be negative: " + priceCents);
        }
        this.priceCents = priceCents;
    }

    private static String requireText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
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
