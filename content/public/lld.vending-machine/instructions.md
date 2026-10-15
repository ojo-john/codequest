# Vending machine

Model a vending machine. Money is in cents.

| Member | Contract |
|---|---|
| `stock(code, priceCents, count)` | Adds `count` items to slot `code` at `priceCents`. A blank code, a price that isn't a positive multiple of 5, a count of 0 or less, or a different price for an existing slot throws `IllegalArgumentException`. |
| `insert(cents)` | Accepts one coin: 5, 10, 25 or 100. Anything else throws `IllegalArgumentException`. |
| `balance()` | Money inserted in the current transaction. |
| `remaining(code)` | Items left in the slot (0 if the slot doesn't exist). |
| `select(code)` | Sells one item, ends the transaction and returns the change in cents. An unknown slot throws `IllegalArgumentException`; a sold-out slot or too little money throws `IllegalStateException` and **changes nothing** (the balance stays). |
| `cancel()` | Ends the transaction and returns the balance as a refund. |

**Design for change.** This is the classic low-level design interview question, and it rarely
stops at version 1. Keep pricing, stock and money handling in clear places: the next quest adds
a requirement to this machine.
