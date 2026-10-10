package workshop;

/** A token-bucket rate limiter with the time passed in. */
public final class RateLimiter {
    private final int capacity;
    private final long refillIntervalMillis;
    private int tokens;
    private long lastRefillMillis;

    public RateLimiter(int capacity, long refillIntervalMillis, long startMillis) {
        if (capacity <= 0 || refillIntervalMillis <= 0) {
            throw new IllegalArgumentException("capacity and interval must be positive");
        }
        this.capacity = capacity;
        this.refillIntervalMillis = refillIntervalMillis;
        this.tokens = capacity;
        this.lastRefillMillis = startMillis;
    }

    public boolean tryAcquire(long nowMillis) {
        refill(nowMillis);
        if (tokens == 0) {
            return false;
        }
        tokens--;
        return true;
    }

    public int available(long nowMillis) {
        refill(nowMillis);
        return tokens;
    }

    private void refill(long nowMillis) {
        if (nowMillis < lastRefillMillis) {
            throw new IllegalArgumentException("time went backwards");
        }
        long intervals = (nowMillis - lastRefillMillis) / refillIntervalMillis;
        if (intervals > 0) {
            tokens = (int) Math.min(capacity, tokens + intervals);
            // A full bucket doesn't bank time towards future tokens.
            lastRefillMillis = tokens == capacity ? nowMillis : lastRefillMillis + intervals * refillIntervalMillis;
        } else if (tokens == capacity) {
            lastRefillMillis = nowMillis;
        }
    }
}
