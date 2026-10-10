package workshop;

/** A cache whose entries expire a fixed time after they were written. */
public final class TtlCache {
    public TtlCache(long ttlMillis) {
        // Validate and set up here.
    }

    /** Stores the value; it is readable until (but not at) nowMillis + ttl. */
    public void put(String key, String value, long nowMillis) {
        throw new UnsupportedOperationException("not implemented yet");
    }

    /** The value if present and not expired at nowMillis, otherwise null. */
    public String get(String key, long nowMillis) {
        throw new UnsupportedOperationException("not implemented yet");
    }

    /** How many entries are live at nowMillis. */
    public int size(long nowMillis) {
        throw new UnsupportedOperationException("not implemented yet");
    }
}
