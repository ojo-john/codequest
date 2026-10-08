# Change request: bulk discount

> **From:** the shop owner
> Customers who buy at least 3 of the same item should get 10% off that line. Can we have it
> as one of the price options at checkout?

## Rules
- Every line with a quantity of at least `MIN_QUANTITY` (3) gets `PERCENT` (10) percent off
  **that line**, rounded down to a whole cent. Other lines pay full price.
- Shipping is worked out on the **discounted** amount, and only if the cart requires shipping
  (`cart.shippingCentsFor(...)`).

## The real requirement
Write `BulkDiscountPricing implements PricingStrategy`, and **do not change** `ShoppingCart`,
`PriceComparison`, or any existing strategy. If the design from quests 4–6 is right, the new
rule plugs straight in: `PriceComparison.cheapest` will consider it, and `cart.totalCents(...)`
will accept it, without either knowing it exists.

## Reflect
Did you need to change anything else? If you did, what in the earlier design forced it?
