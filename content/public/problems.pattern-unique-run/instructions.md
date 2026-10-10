# Longest unique run

Write `UniqueRun.longest(String text)`: the length of the longest **contiguous** part of `text`
in which no character repeats. The empty string gives 0; `null` throws
`IllegalArgumentException`. Characters are compared exactly (`'a'` and `'A'` differ).

| Input | Result | Why |
|---|---|---|
| `"abcabcbb"` | 3 | `"abc"` |
| `"bbbbb"` | 1 | `"b"` |
| `"pwwkew"` | 3 | `"wke"` (`"pwke"` isn't contiguous) |

Aim for O(n).
