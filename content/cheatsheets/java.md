## Collections at a glance

| Need | Use | Notes |
|---|---|---|
| Ordered list, index access | `ArrayList<E>` | `get`/`set` O(1); add at end amortized O(1); insert/remove in the middle O(n) |
| Stack or queue | `ArrayDeque<E>` | `push`/`pop`/`peek` (stack), `offer`/`poll`/`peek` (queue); no `null` elements |
| Key → value | `HashMap<K, V>` | average O(1); `getOrDefault`, `merge`, `computeIfAbsent` |
| Sorted keys | `TreeMap<K, V>` | O(log n); `floorKey`, `ceilingKey`, `headMap`, `tailMap` |
| Unique items | `HashSet<E>` / `TreeSet<E>` | `add` returns `false` if already present |
| Priority queue | `PriorityQueue<E>` | min-heap by default; `offer`/`poll` O(log n), `peek` O(1) |

## Idioms

```java
counts.merge(word, 1, Integer::sum);                       // count occurrences
groups.computeIfAbsent(key, k -> new ArrayList<>()).add(v); // group values
PriorityQueue<int[]> maxFirst = new PriorityQueue<>((a, b) -> Integer.compare(b[0], a[0]));
list.sort(Comparator.comparing(Person::age).thenComparing(Person::name));
int[] copy = Arrays.copyOf(values, values.length * 2);     // grow an array
```

## Pitfalls

- Compare objects with `equals`, not `==`. With `Integer`, `==` only seems to work for −128…127 (cached values) and fails outside that range.
- Override `equals` and `hashCode` together for keys in hash collections.
- `Math.abs(Integer.MIN_VALUE)` is still negative; `(a + b) / 2` can overflow (use `a + (b - a) / 2`).
- Comparators: use `Integer.compare(a, b)`, never `a - b` (overflows).
- Don't modify a collection while iterating it with for-each; use an `Iterator` and `remove()`.
- `String` is immutable; build strings in loops with `StringBuilder`.
- Integer division truncates toward zero; `%` can be negative for negative operands.
