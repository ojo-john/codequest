# The upside-down ranking

> **Bug report:** "Rankings are fine in everyday games. In the stress-test league, where scores
> go from about −2 billion to +2 billion, the player with the lowest score is ranked first."

`Ranking.byScore(String[] names, int[] scores)` returns the names from highest score to lowest;
players with equal scores keep their input order.

## Your job
1. **Diagnose**: find the root cause (you'll be asked about it after you pass).
2. **Fix** it with the smallest change that removes the cause.
3. **Prove it**: click **＋ Test file** and write a JUnit test that would have failed on the
   original code. On Submit, CodeQuest runs your tests against the original buggy version: they
   must catch it (and pass on correct code).
