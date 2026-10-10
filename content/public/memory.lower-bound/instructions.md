# From memory: binary search

Write `LowerBound.firstAtLeast(int[] sorted, int target)`: the first index `i` with
`sorted[i] >= target` in an ascending array (duplicates allowed), or `sorted.length` if there is
none. `null` throws `IllegalArgumentException`. It must be O(log n).

**From memory.** No template, snippets or step-by-step hints here: write it the way you would on
a whiteboard, then run the samples. Library shortcuts that do the whole job (like `Arrays.sort`
or `Collections.reverse`) defeat the point, so don't use them.
