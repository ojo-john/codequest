# Build a stack

Implement `IntStack`, a last-in-first-out stack of `int` values, **without** using any Java
collection. It stores its items in an `int[]` that starts with room for 4 and **doubles** when
it fills up.

| Method | Behaviour |
|---|---|
| `push(int value)` | Puts `value` on top. Never fails: the array grows as needed. |
| `pop()` | Removes and returns the top value. On an empty stack, throws `IllegalStateException`. |
| `peek()` | Returns the top value without removing it. On an empty stack, throws `IllegalStateException`. |
| `isEmpty()` | `true` when there are no values. |
| `size()` | How many values the stack holds. |

## Example

```java
IntStack s = new IntStack();
s.push(1);
s.push(2);
s.pop();   // 2
s.peek();  // 1
s.size();  // 1
```

Push and pop should be O(1) (amortized, for push).
