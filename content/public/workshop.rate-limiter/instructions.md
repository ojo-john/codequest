# Rate limiter

Build a token-bucket `RateLimiter`.

| Member | Contract |
|---|---|
| `new RateLimiter(int capacity, long refillIntervalMillis, long startMillis)` | The bucket starts **full** at `startMillis`. A capacity or interval of 0 or less throws `IllegalArgumentException`. |
| `tryAcquire(nowMillis)` | Takes one token and returns `true`, or returns `false` if none is available. |
| `available(nowMillis)` | Tokens available at `nowMillis`. |

**Refill rule.** Each full `refillIntervalMillis` that passes adds one token, never above
`capacity`. Time spent while the bucket is full does **not** bank tokens: refill counting
restarts from the moment the bucket was last full. A `nowMillis` earlier than a time already
seen throws `IllegalArgumentException`.

Use integer arithmetic only: no floating point, no sleeping, no background threads.
