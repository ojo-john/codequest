# From memory: BFS

Vertices are `0 … n − 1`; `edges` lists undirected edges as `{u, v}` pairs. Write
`GraphBfs.distances(int n, int[][] edges, int start)`: for each vertex, the fewest edges on a
path from `start` (`0` for `start` itself, `-1` if unreachable). A `start` outside `0 … n − 1`
throws `IllegalArgumentException`. Aim for O(V + E).

**From memory.** No template, snippets or step-by-step hints here: write it the way you would on
a whiteboard, then run the samples. Library shortcuts that do the whole job (like `Arrays.sort`
or `Collections.reverse`) defeat the point, so don't use them.
