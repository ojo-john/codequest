# Digital products

The shop now sells e-books. They have a SKU, name, category and price like everything else, can
go in any cart — but they **never need shipping**.

## What you write

1. `Product.requiresShipping()` — returns `true`. This is the behaviour subclasses can change.
2. `DigitalProduct` (its constructor is given) — override `requiresShipping()` to return `false`.
3. `ShoppingCart.requiresShipping()` — `true` if **at least one** line's product requires
   shipping. An empty cart needs no shipping.
4. `ShoppingCart.shippingCentsFor(long amountCents)` — the shipping fee for that amount
   (`Checkout.shippingCents`) if the cart requires shipping, otherwise `0`.
5. Make `RegularPricing` and `PercentOffPricing` use `cart.shippingCentsFor(...)`, so a cart of
   only digital products is never charged shipping. (`MemberPricing` never charges shipping.)

## Why inheritance here?
A `DigitalProduct` can stand in **anywhere** a `Product` is expected — the cart, the line totals,
the reports — and everything still behaves correctly. That substitutability is what justifies
`extends`.

Compare the alternatives and write down which you'd choose and why:
- a `boolean digital` field on `Product` (every caller has to remember to check it), or
- **composition**: `Product` holds a `ShippingPolicy` object. When would that beat inheritance?
  (Hint: what if a product could be both digital and gift-wrapped and shipped separately?)
