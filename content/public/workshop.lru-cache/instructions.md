# LRU cache

Build `LruCache`, a fixed-capacity map from `String` keys to `String` values.

| Member | Contract |
|---|---|
| `new LruCache(int capacity)` | A capacity of 0 or less throws `IllegalArgumentException`. |
| `get(key)` | The value, or `null` if absent. A successful `get` counts as a **use**. |
| `put(key, value)` | Adds or replaces the entry; also a use. If the cache now holds more than `capacity` entries, remove the **least recently used** one. |
| `size()` | How many entries are held. |

`get` and `put` must be O(1) on average.

**Engineering note.** `LinkedHashMap` with access order can do this in a few lines, and in real
code that's a fine choice; say so in an interview. Here, build it from a `HashMap` plus a doubly
linked list so you can explain what the library does for you.

Single-threaded only: concurrent access is a separate design question.
