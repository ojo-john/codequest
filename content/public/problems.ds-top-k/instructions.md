# Top K

Write `TopK.largest(int[] values, int k)`: the `k` largest values, **largest first**.
Duplicates count separately (`[5, 5, 1]` with `k = 2` gives `[5, 5]`).

- `k = 0` gives an empty array.
- A `null` array, a negative `k`, or `k` larger than the number of values throws
  `IllegalArgumentException`.
- Don't modify `values`.

| Call | Result |
|---|---|
| `largest([3, 1, 4, 1, 5], 2)` | `[5, 4]` |
| `largest([2, 2, 2], 2)` | `[2, 2]` |

Aim for O(n log k): keep only k values around, not all n.
