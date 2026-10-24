## When it applies

Optimal substructure (the best answer is built from best answers to subproblems) **and** overlapping subproblems (the same subproblem is solved many times). If subproblems don't overlap, plain divide and conquer is enough.

## Recipe

1. **State:** what does `dp[i]` (or `dp[i][j]`) mean, in one sentence?
2. **Transition:** how does a state follow from smaller ones?
3. **Base cases.**
4. **Order:** compute smaller states first (bottom-up), or memoize recursion (top-down).
5. **Answer:** which state holds it?
6. **Space:** if a row only needs the previous row, keep two rows.

## Classic shapes

| Problem | State | Transition |
|---|---|---|
| Climbing stairs / Fibonacci | ways to reach step i | `dp[i] = dp[i-1] + dp[i-2]` |
| House robber | best up to house i | `max(dp[i-1], dp[i-2] + value[i])` |
| Coin change (fewest coins) | fewest coins for amount a | `min over coins c: dp[a-c] + 1` |
| 0/1 knapsack | best value with capacity w using the first i items | skip or take item i |
| Longest common subsequence | LCS of prefixes i, j | match: `dp[i-1][j-1] + 1`, else `max(dp[i-1][j], dp[i][j-1])` |
| Edit distance | edits between prefixes i, j | `min(insert, delete, replace)` |
| Longest increasing subsequence | LIS ending at i | O(n²), or O(n log n) with patience sorting |

## Costs

Time ≈ number of states × work per transition. Memoized recursion also uses stack space proportional to the depth.
