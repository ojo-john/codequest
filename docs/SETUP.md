# Setup

Phase 0 state: execution proof gate **passed** on Docker and Vercel (2026-10-03); no product UI
yet. Steps marked **manual** need you; nothing in them is claimed as configured until there is
evidence.

## Prerequisites

- Node **24.x** (pinned in `.nvmrc`). On this machine it is a user-local install at
  `~/.local/node`, added to `PATH` in `~/.zshrc`.
- Docker (local runner, and building the image that is published to Vercel).
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
npm run runner:docker-build   # verifies toolchain checksums, builds codequest-runner:local, runs the contract runner's tests
npm run runner:local          # proof + smoke suites against Docker; evidence in docs/evidence/
```

The image is linux/amd64 to mirror Vercel; on Apple Silicon it runs under emulation, so timings
are ~3–5× slower than on Vercel.

## Vercel Sandbox

One-time (done 2026-10-03 for project `codequest`, team `ojo-johns-projects`):

1. **Manual:** `npx vercel login`, then `npx vercel link` (project `codequest`, Hobby).

Each time the image inputs change (`runner/toolchain.json`, `runner/docker/`, `runner/harness/`):

2. `npx vercel vcr login docker` (registry credentials, ~12 h).
3. `npm run runner:publish` — builds the image (running the contract runner's tests), pushes it,
   writes `runner/image-manifest.json` with the digest-pinned reference.
4. Set `JAVA_RUNNER_IMAGE` to that reference in the Vercel project env (development, preview,
   production), then `npx vercel env pull .env.local`. Keeping it in Vercel means the 12-hourly
   token refresh (`vercel env pull`) never wipes it.
5. `npm run runner:check` — proof + smoke against Vercel; evidence in `docs/evidence/`.
6. Delete the superseded image (`npx vercel vcr image ls codequest-runner`, then
   `npx vercel vcr image rm codequest-runner <id>` for the old index and its image).

Locally, `VERCEL_OIDC_TOKEN` in `.env.local` expires after ~12 h; refresh with
`npx vercel env pull .env.local`.

## Supabase — local (no account needed)

```sh
npm run db:start              # minimal local stack in Docker (Postgres, Auth, REST)
npm run db:reset              # re-apply supabase/migrations from scratch
npm run db:lint               # plpgsql_check over all functions
npm run test:integration      # authorization (two users + anonymous), ledger, project-file conflicts
npm run db:verify-backup      # backup -> restore round-trip + failed-restore safety, local only
```

Integration tests refuse to run against anything but a loopback database.

## Supabase — cloud project (not created yet)

Free tier allows 2 active projects; FPL already uses one, so `codequest` takes the second.

1. **Manual:** `npx supabase login` (browser), then create the project (dashboard or
   `npx supabase projects create`), and `npx supabase link --project-ref <ref>`.
2. `npx supabase db push` — applies `supabase/migrations`.
3. Set in the Vercel project env: `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and server-only `SUPABASE_SECRET_KEY`.
4. **Manual:** GitHub OAuth app + Supabase Auth provider, with the local and production
   callback URLs (Phase 1, when sign-in UI exists).

## Backups (spec §64)

Supabase Free has no automatic backups and pauses after 7 idle days. Owner-run:

```sh
SUPABASE_DB_URL=... npm run db:backup                         # writes backups/codequest-<time>.dump (git-ignored)
SUPABASE_DB_URL=... npm run db:restore -- --file <dump> --wipe-existing-data
```

Restore applies data onto a database that already has the migrations, wiping and reloading in
a single transaction — a failed restore leaves the existing data untouched.
