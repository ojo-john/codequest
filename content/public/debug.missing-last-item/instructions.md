# The missing last item

> **Bug report:** "The order total is always a bit low. For a basket of 3 items costing 1, 2 and
> 3 it says 3 instead of 6. A single item shows a total of 0."

`Stats.sumAll(int[] values)` should return the sum of every value (0 for an empty array).

## Your job
1. **Diagnose**: find the root cause (you'll be asked about it after you pass).
2. **Fix** it with the smallest change that removes the cause.
3. **Prove it**: click **＋ Test file** and write a JUnit test that would have failed on the
   original code. On Submit, CodeQuest runs your tests against the original buggy version: they
   must catch it (and pass on correct code).
