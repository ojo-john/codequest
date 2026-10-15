# TTL cache

Build `TtlCache`: entries expire `ttlMillis` after they were last written.

| Member | Contract |
|---|---|
| `new TtlCache(long ttlMillis)` | A TTL of 0 or less throws `IllegalArgumentException`. |
| `put(key, value, nowMillis)` | Stores (or replaces) the entry; it is live while `now < nowMillis + ttl`. |
| `get(key, nowMillis)` | The value if live at `nowMillis`, otherwise `null`. |
| `size(nowMillis)` | How many entries are live at `nowMillis`. |

**Why is the time a parameter?** Calling `System.currentTimeMillis()` inside the cache makes it
impossible to test without sleeping. Passing the time in (or injecting a clock) makes expiry
deterministic: the tests here check behaviour at exact instants, including the boundary.

Expired entries should not pile up forever; removing them when you notice them is enough here.
