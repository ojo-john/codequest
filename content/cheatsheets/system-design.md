## Interview flow

1. **Requirements:** functional (what it does) and non-functional (scale, latency, availability, consistency). Ask; don't assume silently.
2. **Estimates:** users, requests per second (average and peak, with the peak factor stated), storage, bandwidth.
3. **API:** the main calls, their inputs and outputs.
4. **Data model:** what is stored, keys, access patterns → storage choice.
5. **High-level design:** components and the path of a request.
6. **Deep dives:** the bottleneck, failure modes, trade-offs.

## Numbers worth knowing

- 1 day ≈ 86,400 s ≈ 10⁵ s. 1 million requests a day ≈ 12 per second on average.
- Memory read ≈ 100 ns; SSD read ≈ 100 µs; a round trip within a data centre ≈ 0.5 ms; across continents ≈ 100–150 ms.

## Building blocks

| Need | Consider | Trade-off |
|---|---|---|
| Repeated reads of the same static content | CDN | staleness; invalidation |
| Read-heavy data | Cache (cache-aside) or read replicas | stale reads; replication lag |
| Slow or bursty work | Message queue + workers | eventual completion; duplicates (make consumers idempotent) |
| Data beyond one machine | Partitioning (sharding) by a well-spread key | cross-shard queries; hot keys |
| Many servers | Stateless services behind a load balancer | session state moves to a shared store |
| Real-time updates | WebSockets / server-sent events | connection management |
| Exactly-once effects | Idempotency keys | storage for the keys |

## Consistency

- **Strong:** every read sees the latest write (simpler to reason about, costs latency/availability).
- **Eventual:** replicas converge; reads may be stale for a while.
- Under a network partition you trade consistency against availability (CAP).
