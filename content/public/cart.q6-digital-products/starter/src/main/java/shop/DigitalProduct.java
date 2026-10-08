package shop;

/** A product delivered electronically: it never needs shipping. */
public class DigitalProduct extends Product {
    public DigitalProduct(String sku, String name, String category, long priceCents) {
        super(sku, name, category, priceCents);
    }

    // TODO: tell the rest of the shop this product doesn't need shipping.
}
