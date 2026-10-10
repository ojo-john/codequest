# The reshuffled leaderboard

> **Bug report:** "After the results page shows the top three, the full leaderboard is in the
> wrong order: it's sorted by score instead of finishing order."

`Leaderboard` keeps scores in finishing order. `scores()` returns them in that order and
`top3()` returns the three highest, highest first. Calling `top3()` must not change anything.

## Your job
1. **Diagnose**: find the root cause (you'll be asked about it after you pass).
2. **Fix** it with the smallest change that removes the cause.
3. **Prove it**: click **＋ Test file** and write a JUnit test that would have failed on the
   original code. On Submit, CodeQuest runs your tests against the original buggy version: they
   must catch it (and pass on correct code).
