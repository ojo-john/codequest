## Representations

- **Adjacency list** (`List<List<Integer>>`): O(V + E) space; the default.
- **Adjacency matrix**: O(V²) space; O(1) edge check; fine for dense, small graphs.
- **Grid**: cells are vertices, up/down/left/right are edges; mark visited cells.

## Algorithms

| Problem | Algorithm | Time |
|---|---|---|
| Shortest path, unweighted | BFS | O(V + E) |
| Reachability, components, cycles | DFS or BFS | O(V + E) |
| Shortest path, non-negative weights | Dijkstra (with a heap) | O((V + E) log V) |
| Shortest path, negative weights | Bellman–Ford | O(V · E) |
| Order with dependencies (DAG) | Topological sort (Kahn's algorithm or DFS) | O(V + E) |
| Minimum spanning tree | Kruskal (sort + union-find) or Prim (heap) | O(E log E) |
| Dynamic connectivity | Union-find | ~O(1) amortized per operation |

## BFS checklist

1. Mark the start as visited when you **enqueue** it, not when you dequeue it.
2. Distance of a neighbour = distance of the current vertex + 1.
3. Unreachable vertices keep their "not visited" value (e.g. −1).

## Cycle detection

- Undirected: DFS that finds a visited vertex other than the parent, or union-find that joins two already-connected vertices.
- Directed: DFS with three colours (unvisited, on the current path, finished), or Kahn's algorithm leaving vertices unprocessed.
