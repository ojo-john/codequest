# Setup

Phase 0 state: execution proof only (no product UI yet). Steps marked **manual** need you;
nothing in them is claimed as configured until there is evidence.

## Prerequisites

- Node **24.x** (pinned in `.nvmrc`; this machine uses a user-local install at `~/.local/node`,
  so prefix commands with `export PATH=~/.local/node/bin:$PATH`).
- Docker (for the local runner).
- Vercel + Supabase accounts (the same ones used for the FPL project).

## Install, test, build

```sh
npm ci
npm run typecheck   # next typegen + tsc
npm test            # vitest unit tests
npm run lint
npm run build
```

## Local execution runner (no cloud, no quota)

```sh
npm run runner:docker-build   # builds codequest-runner:local from runner/toolchain.json (checksums verified)
npm run runner:local          # proof + smoke suites against Docker; evidence in docs/evidence/
```

The image is linux/amd64 to mirror Vercel; on Apple Silicon it runs under emulation, so timings
are ~3–5× slower than native.

## Vercel Sandbox proof (manual auth, then scripted)

1. **Manual:** `npx vercel login`, then in this directory `npx vercel link` (create a new
   project named `codequest`; keep it on Hobby).
2. **Manual:** `npx vercel env pull .env.local` (writes `VERCEL_OIDC_TOKEN`, valid ~12 h).
3. `npm run runner:prepare` — builds the Java snapshot; writes `runner/snapshot-manifest.json`.
4. Put the printed `JAVA_SNAPSHOT_ID` in `.env.local`.
5. `npm run runner:check` — proof + smoke against Vercel; evidence in `docs/evidence/`.
6. Record measured CPU/time in `docs/COSTS.md`.

Snapshots expire (default 30 days, `SNAPSHOT_EXPIRATION_DAYS`); re-run step 3 to rebuild.

## Supabase (Phase 0 step 2 — not started)

Free tier allows 2 active projects; FPL already uses one. Create `codequest` as the second.
Migrations, RLS and the two-user authorization test land in the next step.
