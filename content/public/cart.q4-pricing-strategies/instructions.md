# Pricing strategies

The shop wants promotions. If `ShoppingCart` knew about every promotion, it would change every
time marketing had an idea. Instead, pricing is **abstracted** behind an interface:

```java
public interface PricingStrategy {
    long totalCents(ShoppingCart cart);
}
```

The cart only promises "give me a strategy and I'll ask it for my total". It never learns which
strategy it was given.

## What's given
`PricingStrategy` and `RegularPricing` (subtotal + the shipping rule from quest 1) — read
`RegularPricing` as the worked example.

## What you write

### `PercentOffPricing(int percent)`
- `percent` must be between **1 and 90** inclusive; otherwise `IllegalArgumentException`.
- discount = subtotal × percent / 100, **rounded down** to a whole cent (integer division does
  this; use `Math.multiplyExact` for the multiplication).
- total = (subtotal − discount) + shipping, where shipping is worked out on the **discounted**
  amount — so a discount can push a cart back below the free-shipping threshold.

### `ShoppingCart.totalCents(PricingStrategy pricing)`
Returns `pricing.totalCents(this)`. A `null` strategy → `IllegalArgumentException`.

## Example
A cart of 3 × 333¢ has a subtotal of 999¢. With 10% off, the discount is 99¢ (not 99.9¢), so the
customer pays 900 + 499 shipping = **1399¢**.
