package shop;

/** One parsed order line: a SKU and a quantity. */
public record OrderLine(String sku, int quantity) {
}
