# Shortest grid path

`grid` is an array of equal-length rows. Each character is `.` (open), `#` (wall), `S` (start,
exactly one) or `E` (end, exactly one). A move goes one cell up, down, left or right, never
through a wall or off the grid.

Write `GridPath.shortest(String[] grid)`: the fewest moves from `S` to `E`, or `-1` if `E`
can't be reached.

```
S.#        S..
..#   → 4  ##.  → 4
..E        E..
```

Every move costs the same, so think about which search finds the shortest route first.
