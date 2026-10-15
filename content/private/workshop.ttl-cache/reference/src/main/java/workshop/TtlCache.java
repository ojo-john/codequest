package workshop;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

/** A cache whose entries expire a fixed time after they were written. */
public final class TtlCache {
    private record Entry(String value, long expiresAt) {
    }

    private final long ttlMillis;
    private final Map<String, Entry> entries = new HashMap<>();

    public TtlCache(long ttlMillis) {
        if (ttlMillis <= 0) {
            throw new IllegalArgumentException("ttl must be positive");
        }
        this.ttlMillis = ttlMillis;
    }

    public void put(String key, String value, long nowMillis) {
        entries.put(key, new Entry(value, nowMillis + ttlMillis));
    }

    public String get(String key, long nowMillis) {
        Entry entry = entries.get(key);
        if (entry == null) {
            return null;
        }
        if (nowMillis >= entry.expiresAt()) {
            entries.remove(key);
            return null;
        }
        return entry.value();
    }

    public int size(long nowMillis) {
        Iterator<Entry> iterator = entries.values().iterator();
        while (iterator.hasNext()) {
            if (nowMillis >= iterator.next().expiresAt()) {
                iterator.remove();
            }
        }
        return entries.size();
    }
}
