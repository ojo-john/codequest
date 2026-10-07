# Products, lines and a cart

Quest 1 gave you arithmetic. Now the shop needs **objects** that carry their own data and
behaviour. Your project already contains `Checkout` from quest 1.

## What's given

`Product` is complete — read it as a worked example of a class: private fields set once in the
constructor, and accessor methods (`sku()`, `name()`, `category()`, `priceCents()`).

## What you write

### `CartItem.lineTotalCents()`
A cart line is a product plus a quantity. Its total is price × quantity. You already wrote that
calculation — **reuse** `Checkout.lineTotalCents` instead of repeating it.

### `ShoppingCart`
The cart keeps one `CartItem` per SKU in a `LinkedHashMap` (so lines stay in the order they were
first added).

| Method | Behaviour |
|---|---|
| `add(product, quantity)` | Adds a line. If that SKU is already in the cart, **increase** its quantity instead of adding a second line. |
| `quantityOf(sku)` | Quantity of that SKU, or `0` if it isn't in the cart. |
| `itemCount()` | Total units across all lines (2 teas + 1 cake = 3). |
| `subtotalCents()` | Sum of all line totals. |
| `items()` | The lines, in the order each SKU was first added. |

`CartItem` is immutable (its fields are `final`), so "increasing the quantity" means replacing
the line with a new `CartItem`.

## Example

```java
ShoppingCart cart = new ShoppingCart();
Product tea = new Product("TEA-1", "Green tea", "drinks", 250);
cart.add(tea, 2);
cart.add(tea, 1);
cart.quantityOf("TEA-1"); // 3
cart.items().size();      // 1 — still one line
cart.subtotalCents();     // 750
```
