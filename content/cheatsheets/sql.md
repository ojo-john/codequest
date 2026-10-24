## Query order (logical)

`FROM` → `JOIN` → `WHERE` → `GROUP BY` → `HAVING` → `SELECT` → `DISTINCT` → `ORDER BY` → `LIMIT`

## Joins

| Join | Keeps |
|---|---|
| `INNER JOIN` | rows with a match on both sides |
| `LEFT JOIN` | every left row; right columns `NULL` without a match |
| `FULL OUTER JOIN` | every row from both sides |
| `CROSS JOIN` | every combination |

## Patterns

```sql
-- Count per group, keep groups with more than 5
SELECT customer_id, COUNT(*) AS orders
FROM orders
GROUP BY customer_id
HAVING COUNT(*) > 5;

-- Rows with no match (anti-join)
SELECT c.id FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE o.id IS NULL;

-- Top 3 per group with a window function
SELECT * FROM (
  SELECT o.*, ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY total DESC) AS rn
  FROM orders o
) ranked
WHERE rn <= 3;
```

## Pitfalls

- `WHERE` filters rows before grouping; `HAVING` filters groups after.
- `NULL = NULL` is not true; use `IS NULL`. `COUNT(column)` skips `NULL`s, `COUNT(*)` doesn't.
- Index the columns you filter and join on; an index speeds reads and slows writes slightly.
- Use parameters (prepared statements), never string concatenation, to avoid SQL injection.
- Transactions: ACID; pick the isolation level the invariant needs.
