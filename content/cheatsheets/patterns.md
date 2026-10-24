## Cue → pattern (a cue suggests, the constraints decide)

| Cue | Try |
|---|---|
| Pair/target sum in an unsorted array | Hash map of seen values |
| Sorted array, pairs or partitions | Two pointers from both ends |
| Contiguous subarray/substring with a condition | Sliding window |
| Sorted data, or a yes/no answer that flips once | Binary search (on the index or on the answer) |
| Shortest path, unweighted | BFS |
| All paths / connected components / cycle | DFS |
| k largest / smallest, streaming | Heap of size k |
| Next greater/smaller element | Monotonic stack |
| Choices with overlapping subproblems | Dynamic programming |
| All combinations / permutations | Backtracking |
| Intervals | Sort by start, then sweep |

## Templates (shape, not code to copy)

- **Sliding window:** grow `right`; while the window breaks the rule, shrink `left`; record the best.
- **Binary search (lower bound):** `lo = 0, hi = n`; while `lo < hi`: `mid = lo + (hi - lo) / 2`; if `ok(mid)` then `hi = mid` else `lo = mid + 1`.
- **Monotonic stack:** for each item, pop while the top is smaller (for "next greater"); the popped items found their answer.
- **Backtracking:** choose → recurse → un-choose; prune as early as possible.

## Before coding

Clarify input size and edge cases → brute force and its cost → the better idea and why it's correct → its cost → code → test with an edge case.
