# The crash without a nickname

> **Bug report:** "The welcome screen crashes with a NullPointerException for every user who
> skipped the nickname step. Users with a nickname, or a blank one, are fine."

`Greeting.displayName(String nickname, String fullName)` returns the trimmed nickname when it
has any non-space characters, and `fullName` otherwise (including when `nickname` is `null`).

## Your job
1. **Diagnose**: find the root cause (you'll be asked about it after you pass).
2. **Fix** it with the smallest change that removes the cause.
3. **Prove it**: click **＋ Test file** and write a JUnit test that would have failed on the
   original code. On Submit, CodeQuest runs your tests against the original buggy version: they
   must catch it (and pass on correct code).
