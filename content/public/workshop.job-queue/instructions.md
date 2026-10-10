# Priority job queue

Build `JobQueue`.

| Member | Contract |
|---|---|
| `submit(name, priority)` | Queues a job. A `null` or blank name throws `IllegalArgumentException`. |
| `next()` | Removes and returns the name of the job to run next, or `null` if none are waiting. |
| `pending()` | How many jobs are waiting. |

The next job is the one with the **highest** priority; among equal priorities, the one
submitted **first**. Both `submit` and `next` should be O(log n).

**The catch.** `PriorityQueue` alone is not stable: equal priorities can come out in any order.
Fairness has to be part of the ordering you give it.
