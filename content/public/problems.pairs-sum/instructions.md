# Pair sum

Write `PairSum.indicesOf(int[] nums, int target)`. Return the positions `{i, j}` with `i < j`
and `nums[i] + nums[j] == target`. The two positions must be different (a value can't pair with
itself). If several pairs work, return the one whose **second** position `j` is smallest, and
for that `j` the **smallest** `i`. If none works, return an empty array. `null` throws
`IllegalArgumentException`.

| Call | Result |
|---|---|
| `indicesOf([2, 7, 11, 15], 9)` | `[0, 1]` |
| `indicesOf([3, 3], 6)` | `[0, 1]` |
| `indicesOf([1, 2], 7)` | `[]` |

Aim for O(n): one pass, not every pair.
