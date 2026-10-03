# Security — Java execution

Scope: **owner-personal learning** (spec §65). This is not a public contest judge.

## Layers

| Layer | Where | What it enforces |
|---|---|---|
| Boundary validation | `lib/execution/source-files.ts` | ≤ 20 files, ≤ 200 KB UTF-8, relative `[A-Za-z0-9_-]` dirs + Java-identifier `.java` names, no `..`/`.`/absolute/backslash/NUL, no case-insensitive duplicates. Sources are (path, text) pairs — no archives or symlinks exist to unpack. |
| Fresh disposable VM | `vercel-sandbox-provider.ts` | Restored from the prepared snapshot per job; `persistent: false`; no env vars, no app/DB credentials, no service-role keys inside. |
| Network | snapshot + create | `networkPolicy: "deny-all"`. Prep stage only allows the toolchain hosts; curl is purged before snapshot. |
| Identity | snapshot | Learner code runs as `learner` (no sudo). Harness + JDK are root-owned and read-only. |
| Harness | `runner/harness/run.sh` | Positional args only (never a shell string). `ulimit -u 256` (processes+threads), `-f` 50 MB, no core dumps; `-Xmx256m`; inner `timeout --signal=KILL`; output truncated to 64 KB. |
| Deadlines | `java-executor.ts` | Per-command SIGKILL (wall + 5 s grace), 60 s overall lifetime AbortSignal, platform sandbox timeout; `stop()` always called in `finally`. |
| Grading | `outcome.ts` | Result comes from the JUnit XML report **and** the JVM exit status; stdout is never parsed for results. Report read with `head -c 1 MB`. |

## Known limitations (accepted, documented)

1. **In-JVM report forgery.** Learner code shares the JVM with JUnit, so a shutdown hook can
   rewrite the report and `halt(0)`. Reproduced by the `report-forgery` smoke case (it "succeeds").
   Hidden tests reduce memorisation; they are not secrets from code in the same process. Fixing
   this needs a separate trusted process/uid for result collection — revisit before any
   multi-user or competitive use.
2. **Heap cap ≠ memory cap.** `-Xmx` does not bound native/metaspace/thread memory; the VM's own
   memory (2 GB per vCPU) and the lifetime deadline are the backstop.
3. **DNS.** Recorded per provider by the `dns-lookup` smoke case (Docker: blocked). Outbound
   connections are denied either way (`network-http`).
4. **Local Docker runner** results are self-reported practice evidence, never a trusted cloud
   grade. Never expose the local runner as a network service.

## Verification

`npm run runner:local` (Docker) and `npm run runner:check` (Vercel) run 3 proof cases + 11
adversarial cases + a leftover-environment check, and write evidence to `docs/evidence/`.
