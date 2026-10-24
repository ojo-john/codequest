## Growth, slowest to fastest

`O(1)` < `O(log n)` < `O(n)` < `O(n log n)` < `O(n²)` < `O(n³)` < `O(2ⁿ)` < `O(n!)`

## Reading code

| Shape | Time |
|---|---|
| One loop over n | O(n) |
| Loop that halves (or doubles) its range | O(log n) |
| Two nested loops over n | O(n²) |
| Inner loop runs i times for i = 1…n | O(n²) (n(n+1)/2) |
| Two loops one after the other | O(n + m) — add, don't multiply |
| Recursion with two calls of n − 1 | O(2ⁿ) |
| Divide in half, linear work per level | O(n log n) (merge sort) |

## Rough limits for about 10⁸ simple steps

| n up to | Fits |
|---|---|
| 10–12 | O(n!) |
| 20–25 | O(2ⁿ) |
| 500 | O(n³) |
| 10⁴ | O(n²) |
| 10⁶ | O(n log n) |
| 10⁸ | O(n) |

## Space

- Count extra memory beyond the input: new arrays, maps, the recursion stack.
- Recursion depth d uses O(d) stack space, even if nothing else is allocated.
- Amortized O(1): an occasional expensive step (array doubling) averaged over many cheap ones.

## Common costs

Sorting O(n log n) · binary search O(log n) · hash map get/put average O(1), worst O(n) · heap push/pop O(log n), build from n items O(n) · BFS/DFS O(V + E).
