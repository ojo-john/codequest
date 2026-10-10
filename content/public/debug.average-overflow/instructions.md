# The negative average

> **Bug report:** "Our dashboard shows an average of -1.0 response bytes for two requests that
> were each 2,147,483,647 bytes. Small numbers look fine."

`Averages.mean(int[] values)` returns the mean as a `double`; an empty array throws
`IllegalArgumentException`.

## Your job
1. **Diagnose**: find the root cause (you'll be asked about it after you pass).
2. **Fix** it with the smallest change that removes the cause.
3. **Prove it**: click **＋ Test file** and write a JUnit test that would have failed on the
   original code. On Submit, CodeQuest runs your tests against the original buggy version: they
   must catch it (and pass on correct code).
