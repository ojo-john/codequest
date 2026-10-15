# Change request: making change

Your machine from the last quest is in the starter. The owner says: **"Our machines hold real
coins. Change has to come out of the coins inside, and we run out."**

New rules:

- The machine holds coins: inserted coins go into it at once, and the operator can load more.
- Change (and refunds) are paid from the coins held, using the **fewest coins possible**. If
  several ways use equally few coins, use the most dollars, then quarters, then dimes.
- If the change can't be made from the coins held, `select` throws `IllegalStateException`
  ("exact change only") and changes nothing.

| Member | Contract |
|---|---|
| `stock(code, priceCents, count)` | Adds `count` items to slot `code` at `priceCents`. A blank code, a price that isn't a positive multiple of 5, a count of 0 or less, or a different price for an existing slot throws `IllegalArgumentException`. |
| `insert(cents)` | Accepts one coin: 5, 10, 25 or 100. Anything else throws `IllegalArgumentException`. |
| `balance()` | Money inserted in the current transaction. |
| `remaining(code)` | Items left in the slot (0 if the slot doesn't exist). |
| `select(code)` | Sells one item, ends the transaction and returns the change in cents. An unknown slot throws `IllegalArgumentException`; a sold-out slot or too little money throws `IllegalStateException` and **changes nothing** (the balance stays). |
| `cancel()` | Ends the transaction and returns the balance as a refund. |
| `loadCoins(cents, count)` | **New.** The operator adds `count` coins of one accepted kind. A bad coin or count of 0 or less throws `IllegalArgumentException`. |
| `coinCount(cents)` | **New.** Coins of that kind the machine holds. A bad coin throws `IllegalArgumentException`. |

**Note.** Always taking the largest coin first fails when coins run out. Owing 30¢ with one
quarter and three dimes held, "largest first" takes the quarter and is stuck needing 5¢, yet
three dimes would do. Every earlier rule still holds, and the hidden checks re-test them.
