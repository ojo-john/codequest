package shop;

/**
 * A product delivered electronically. It IS a Product in every way a caller relies on (it has a
 * SKU, a name, a category and a price, and can go in any cart); it just never needs shipping.
 */
public class DigitalProduct extends Product {
    public DigitalProduct(String sku, String name, String category, long priceCents) {
        super(sku, name, category, priceCents);
    }

    @Override
    public boolean requiresShipping() {
        return false;
    }
}
