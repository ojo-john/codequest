# Cheapest price

`PricingStrategy` now has a **default method**, `name()`, which every implementation inherits
(it returns the class's simple name, e.g. `"RegularPricing"`).

## What you write

### `MemberPricing`
Members pay the subtotal and **never** pay shipping.

### `PriceComparison.cheapest(ShoppingCart cart, List<PricingStrategy> strategies)`
Return the strategy that gives the **lowest** total for the cart.
- On a tie, return the one that comes **first** in the list.
- An empty or `null` list → `IllegalArgumentException`.

`cheapest` must work for strategies that don't exist yet. It may only use the
`PricingStrategy` interface — no `instanceof`, no class names.

## Explain it (for yourself)
After it passes, answer in a note or out loud:
1. In `strategy.totalCents(cart)`, which method actually runs, and when is that decided?
2. What would you have to change in `cheapest` to support a new promotion next month?
3. Why is returning the strategy more useful than returning just the lowest number?
