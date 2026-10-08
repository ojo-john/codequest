# Costs and quotas

Free means no required paid plan within quotas — not unlimited capacity (spec §64).
Quotas below are as stated in the spec (checked 2026-10-03); **re-verify against the provider
pages before deploying.**

| Provider | Quota (Hobby / Free) | Our control |
|---|---|---|
| Vercel Sandbox | 5 active CPU-h/month, 420 GB-h memory, 5,000 creations, 20 GB transfer; Hobby max sandbox duration 45 min, 4 vCPU | `MeteredJavaExecutor`: 100 jobs/day, 2,000/month, ≤ 80 % of 18,000 CPU-s/month (worst-case reservation 60 CPU-s/job), 1 active job/user, 24 h pause on provider quota errors. All configurable (`.env.example`). |
| Vercel Container Registry | Runner image ~428 MB (one current digest kept) | Delete superseded images after publishing (`npx vercel vcr image ls codequest-runner`). |
| Supabase Free | 500 MB DB, 1 GB storage, 5 GB egress, 2 active projects, pauses after 7 days idle, no automatic backups | Owner-run export/backup script (Phase 1) |

## Measured per-job cost (Vercel Sandbox, 1 vCPU / 2 GB, iad1, 2026-10-03)

Runner image `runner/image-manifest.json`; evidence `docs/evidence/vercel-all-2026-10-03T23-37-15-474Z.json`.

| Kind of run | Wall time | Active CPU |
|---|---|---|
| Contract-graded run | ~3.0–3.6 s | ~3.4–4.8 s |
| JUnit run (pass / fail / compile error) | ~2.4–4.6 s | ~3.4–5.8 s |
| Hits the 10 s test deadline | ~12.6–13.2 s | ~13–14 s |
| First run after publishing a new image (cold pull) | ~10–16 s | — |

### Provisioning: why an image, not a snapshot

| Option (measured) | Sandbox create |
|---|---|
| Snapshot with JDK (253 MB) | ~8.2 s |
| Near-empty snapshot | ~8.3 s — restore cost is fixed, not size-driven |
| Base image + JDK on a read-only drive | ~1.8 s (+ ~1.2 s first `java`) |
| **Custom image in VCR (chosen)** | **~0.7 s** (+ ~0.25 s first `java`) |

The spec §47 target ("code execution usually under 5 seconds") is now met for warm runs.

### Budget check

- 18,000 CPU-s/month × 80 % = 14,400 CPU-s. At ~4.5 s/normal job ≈ 3,200 jobs; at ~14 s/timeout
  job ≈ 1,000. The CPU meter, not the 2,000-job cap, is what actually protects the quota when
  many runs time out.
- Memory: 2 GB × ~4 s ≈ 0.002 GB-h/job → 2,000 jobs ≈ 4.5 GB-h of 420.
- Creations: 1 per job → ≤ 2,000 of 5,000.
