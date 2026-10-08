# Purchase reports

The shop wants quick reports over a cart's lines. Write each method as a **stream pipeline**.

| Method | Returns |
|---|---|
| `totalsByCategory(items)` | A map from category to the sum of its line totals, **sorted by category**. An empty list gives an empty map. |
| `skusWithLineTotalAtLeast(items, minimumCents)` | SKUs whose line total is **at least** `minimumCents` (inclusive), in alphabetical order. |
| `unitsInCategory(items, category)` | Total quantity of lines in that category (0 if none). |

Useful pieces: `filter`, `map`, `sorted`, `toList()`, `mapToLong(...).sum()`, and
`Collectors.groupingBy(classifier, TreeMap::new, Collectors.summingLong(...))`.

## Explain it (for yourself)
Rewrite **one** of the three as a plain `for` loop (in a comment is fine). Then answer:
- Which version would a teammate understand faster at 3am?
- Does either version mutate anything outside itself?
- Is there any performance difference that matters for a cart?
