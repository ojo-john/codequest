package shop;

/** A cart line priced in integer minor currency units (cents). */
public record LineItem(String sku, long unitPriceCents, int quantity) {
    public LineItem {
        if (unitPriceCents < 0) {
            throw new IllegalArgumentException("unitPriceCents must be >= 0");
        }
        if (quantity <= 0) {
            throw new IllegalArgumentException("quantity must be > 0");
        }
    }

    public long subtotalCents() {
        return Math.multiplyExact(unitPriceCents, quantity);
    }
}
