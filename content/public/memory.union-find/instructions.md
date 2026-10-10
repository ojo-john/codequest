# From memory: union-find

Write `UnionFind` over the elements `0 … n − 1`, each starting in its own set.

| Member | Behaviour |
|---|---|
| `new UnionFind(int n)` | `n` singleton sets; a negative `n` throws `IllegalArgumentException`. |
| `union(a, b)` | Merges the sets of `a` and `b`; returns `true` if they were separate, `false` if already together. |
| `connected(a, b)` | Whether `a` and `b` are in the same set. |
| `components()` | How many sets there are. |

An element outside `0 … n − 1` throws `IllegalArgumentException`. Aim for near-constant
amortized time per operation (union by size or rank, and path compression).

**From memory.** No template, snippets or step-by-step hints here: write it the way you would on
a whiteboard, then run the samples. Library shortcuts that do the whole job (like `Arrays.sort`
or `Collections.reverse`) defeat the point, so don't use them.
