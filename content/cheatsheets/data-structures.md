## Operations

| Structure | Access | Search | Insert | Delete | Notes |
|---|---|---|---|---|---|
| Array / ArrayList | O(1) | O(n) | O(n), end amortized O(1) | O(n) | contiguous, cache-friendly |
| Linked list | O(n) | O(n) | O(1) at a known node | O(1) at a known node | no index access |
| Stack / queue (deque) | top/front O(1) | O(n) | O(1) | O(1) | LIFO / FIFO |
| Hash map / set | — | avg O(1) | avg O(1) | avg O(1) | unordered; worst O(n) |
| Balanced BST (TreeMap) | — | O(log n) | O(log n) | O(log n) | sorted; floor/ceiling |
| Binary heap | min/max O(1) | O(n) | O(log n) | min/max O(log n) | priority queue |
| Trie | — | O(length) | O(length) | O(length) | prefix queries |
| Union-find | — | ~O(1) amortized | — | — | with path compression + union by size |

## Choosing

- Need lookup by key → hash map. Need order or ranges → tree map.
- Need "the smallest/largest so far" repeatedly → heap.
- Need undo, matching brackets, depth-first → stack. Level by level → queue.
- Need "are these connected?" with merges → union-find.
- Need prefix search → trie.

## Trees

- Height of a balanced binary tree: O(log n). A degenerate (list-like) tree: O(n).
- Traversals: pre-order (node, left, right), in-order (left, node, right — sorted for a BST), post-order (left, right, node), level-order (queue).
