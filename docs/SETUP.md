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

## Supabase (Phase 0 step 2 — not started)

Free tier allows 2 active projects; FPL already uses one. Create `codequest` as the second.
Migrations, RLS, the two-user authorization test, and the Supabase `ExecutionUsageLedger`
(atomic admission in one SQL function) land in the next step.
