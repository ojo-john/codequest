# Costs and quotas

Free means no required paid plan within quotas — not unlimited capacity (spec §64).
Quotas below are as stated in the spec (checked 2026-10-03); **re-verify against the provider
pages before deploying.**

| Provider | Quota (Hobby / Free) | Our budget |
|---|---|---|
| Vercel Sandbox | 5 active CPU-h/month, 420 GB-h memory, 5,000 creations, 20 GB transfer; Hobby max sandbox duration 45 min, 4 vCPU | App cap: 100 jobs/day, 2,000/month, 1 active job/user (to implement in Phase 1) |
| Supabase Free | 500 MB DB, 1 GB storage, 5 GB egress, 2 active projects, pauses after 7 days idle, no automatic backups | Owner-run export/backup script (Phase 1) |

## Measured per-job cost

| Date | Provider | Case | Total ms | Active CPU ms | Notes |
|---|---|---|---|---|---|
| 2026-10-03 | Docker (amd64 emulated on arm64) | multi-file-pass | ~15,500 | n/a | Emulation; not representative of Vercel |
| _pending_ | Vercel Sandbox | multi-file-pass | | | Fill from `npm run runner:check` evidence |

Budget check to do with real numbers: 2,000 jobs × active-CPU-seconds/job must stay well under
18,000 CPU-seconds/month (5 h).
