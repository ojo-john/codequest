## Core ideas

- **Race condition:** the result depends on the timing of threads touching shared state.
- **Atomicity:** `count++` is read, add, write: three steps, not one.
- **Visibility:** without synchronization, one thread may not see another's writes.
- **Deadlock:** threads wait on each other's locks forever (avoid by taking locks in one global order).

## Java tools

| Need | Use |
|---|---|
| Mutual exclusion | `synchronized` or `ReentrantLock` |
| A counter or flag | `AtomicInteger`, `AtomicLong`, `AtomicBoolean` |
| A shared map | `ConcurrentHashMap` (`merge`, `compute` are atomic per key) |
| Producer/consumer | `BlockingQueue` (`ArrayBlockingQueue`, `LinkedBlockingQueue`): `put` and `take` block |
| Running tasks | `ExecutorService` (fixed pool); always `shutdown()` |
| Waiting for results | `Future`, `CompletableFuture` |
| Waiting for N events | `CountDownLatch` |
| Limiting concurrent access | `Semaphore` |
| Visibility of one flag | `volatile` (visibility only, not atomic compound actions) |

## Rules of thumb

- Prefer immutable objects and confinement (one thread owns the data) over locks.
- Keep critical sections short; never call unknown code while holding a lock.
- Check-then-act (`if (!map.containsKey(k)) map.put(k, v)`) is a race; use `putIfAbsent` / `computeIfAbsent`.
- Test concurrent code with many threads and repetitions; passing once proves little.
