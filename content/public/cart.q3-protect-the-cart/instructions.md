# Protect the cart

Right now anyone can build a `Product` with a negative price, a `CartItem` with zero units, or
take the list from `items()` and add things to it directly. **Encapsulation** means an object
protects its own rules (its *invariants*) so that the rest of the program can trust it.

Throw `IllegalArgumentException` for every invalid input below.

## `Product`
- `sku`, `name` and `category` must not be `null`, empty or only spaces.
- `priceCents` must not be negative. (A free item, price `0`, is fine.)

## `CartItem`
- The product must not be `null`; the quantity must be at least 1.

## `ShoppingCart`
| Method | Rule |
|---|---|
| `add(product, quantity)` | Reject a `null` product and a quantity below 1. A rejected call must leave the cart **exactly as it was**. |
| `changeQuantity(sku, quantity)` | The SKU must already be in the cart. A negative quantity is rejected. `0` removes the line; anything else replaces the quantity. |
| `remove(sku)` | Removes the line; returns `true` if it was there, `false` otherwise. |
| `isEmpty()` | `true` when the cart has no lines. |
| `items()` | Must not let callers change the cart: changing the returned list (`add`, `clear`, …) must throw `UnsupportedOperationException`. |

> Getters and setters for every field are **not** encapsulation. Notice there is no
> `setQuantity` on `CartItem` and no way to reach the cart's map — only behaviour that keeps the
> rules true.

## Think about
Why validate in the **constructor** rather than in every method that uses the fields?
