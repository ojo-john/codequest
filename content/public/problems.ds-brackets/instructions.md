# Balanced brackets

Write `Brackets.isBalanced(String text)`. It returns `true` when every `(`, `[` and `{` is closed
by the matching `)`, `]` or `}` in the right order, and `false` otherwise. All other characters
are ignored. A `null` text throws `IllegalArgumentException`.

| Input | Result |
|---|---|
| `"([]{})"` | `true` |
| `"([)]"` | `false` — closed in the wrong order |
| `"(("` | `false` — never closed |
| `"a(b)c"` | `true` |

Aim for one pass over the text.
