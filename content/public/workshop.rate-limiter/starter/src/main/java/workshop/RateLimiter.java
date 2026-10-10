package workshop;

/** A token-bucket rate limiter with the time passed in. */
public final class RateLimiter {
    public RateLimiter(int capacity, long refillIntervalMillis, long startMillis) {
        // Validate and set up here. The bucket starts full.
    }

    /** Takes a token if one is available at nowMillis. */
    public boolean tryAcquire(long nowMillis) {
        throw new UnsupportedOperationException("not implemented yet");
    }

    /** Tokens available at nowMillis. */
    public int available(long nowMillis) {
        throw new UnsupportedOperationException("not implemented yet");
    }
}
