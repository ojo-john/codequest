# Checkout totals

You're building the checkout for a small online shop. Money is stored in **cents as `long`**
(integer minor units) — never `double`, which can't represent most decimal prices exactly.

`shop/Checkout.java` already declares three methods. Each currently returns `0`. Make them
correct.

## 1. `lineTotalCents(long unitPriceCents, int quantity)`

The price of one cart line: unit price × quantity.

- A negative price → throw `IllegalArgumentException`.
- A quantity below 1 → throw `IllegalArgumentException`.
- If the result doesn't fit in a `long`, throw `ArithmeticException` instead of silently
  wrapping around to a wrong (possibly negative) total. `Math.multiplyExact` does this for you.

| Call | Result |
|---|---|
| `lineTotalCents(250, 3)` | `750` |
| `lineTotalCents(250, 0)` | throws `IllegalArgumentException` |

## 2. `subtotalCents(long[] unitPricesCents, int[] quantities)`

Line `i` is `unitPricesCents[i]` × `quantities[i]`. Add up **every** line using
`lineTotalCents`, so the same validation applies.

- The two arrays must have the same length; otherwise throw `IllegalArgumentException`.
- An empty cart has a subtotal of `0`.
- Use exact addition (`Math.addExact`) so a huge cart can't overflow silently either.

| Call | Result |
|---|---|
| `subtotalCents(new long[] {250, 400}, new int[] {3, 1})` | `1150` |
| `subtotalCents(new long[] {}, new int[] {})` | `0` |

## 3. `shippingCents(long subtotalCents)`

- Nothing in the cart (`subtotalCents == 0`) → `0`.
- Subtotal **at or above** `FREE_SHIPPING_THRESHOLD_CENTS` → `0`.
- Otherwise → `STANDARD_SHIPPING_CENTS`.

## Before you run it

Think about which inputs are most likely to break a loop or a comparison: the **last** line, an
**empty** cart, and a subtotal **exactly at** the threshold. Hidden checks include those.
