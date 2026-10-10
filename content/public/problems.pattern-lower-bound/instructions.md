# First at least

Write `LowerBound.firstAtLeast(int[] sorted, int target)`. `sorted` is in ascending order (it may
contain duplicates). Return the **first** index `i` with `sorted[i] >= target`, or
`sorted.length` if every value is smaller. `null` throws `IllegalArgumentException`.

| Call | Result |
|---|---|
| `firstAtLeast([1, 3, 5, 7], 5)` | `2` |
| `firstAtLeast([1, 3, 5, 7], 4)` | `2` |
| `firstAtLeast([1, 3, 5, 7], 8)` | `4` |
| `firstAtLeast([2, 2, 2, 3], 2)` | `0` |

It must be O(log n): binary search, not a scan.
