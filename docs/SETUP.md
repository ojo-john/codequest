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
npm run db:start              # local stack in Docker (Postgres, Auth, REST, mail catcher on :54324)
npm run db:env                # writes .env.development.local so `npm run dev` uses the local stack
npm run db:reset              # re-apply supabase/migrations from scratch
npm run db:lint               # plpgsql_check over all functions
npm run test:integration      # authorization (two users + anonymous), ledger, project-file conflicts
npm run test:e2e              # browser tests (sign-in flow) against the dev server + local stack
npm run db:verify-backup      # backup -> restore round-trip + failed-restore safety, local only
```

Local sign-in: `npm run auth:create-owner -- --email you@example.com`, then request a link at
http://127.0.0.1:3000/login and open it from the mail catcher at http://127.0.0.1:54324.
Integration tests refuse to run against anything but a loopback database.

## Supabase — cloud project

Project `codequest` (ref `xhgotwtpgvwrkynzxuqz`, us-east-1) in the **CodeQuest** organization,
created 2026-10-06. The database password is in the git-ignored `.env.supabase.local`.

- Migrations: `npx supabase db push -p "$SUPABASE_DB_PASSWORD"`.
- Auth settings: `npx supabase config diff`, then `npx supabase config push` — the
  `[remotes.production]` block in `supabase/config.toml` holds cloud-only overrides. Review the
  diff first: local defaults can silently change cloud settings.
- Vercel env (production + preview): `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, sensitive `SUPABASE_SECRET_KEY`. Local development
  uses `.env.development.local` (local stack) instead.
- Secret key: `npx supabase projects api-keys --reveal` — without `--reveal` the CLI prints a
  masked key of the same length that the API rejects ("Invalid API key").
- Owner account (created 2026-10-06 for the Supabase account email):
  `SUPABASE_URL=… SUPABASE_SECRET_KEY=… npm run auth:create-owner -- --email <owner>`.
  The built-in email service only delivers to members of the Supabase organization, so the owner
  email must be the Supabase account's email.
- Production (first deployed 2026-10-08): https://codequest-zeta-self.vercel.app. `main` deploys
  automatically (GitHub repo connected to the Vercel project). Vercel Production also sets
  `APP_ORIGIN` to that origin, which must match `site_url` and `additional_redirect_urls` in
  `[remotes.production.auth]` (pushed with `npx supabase config push`). Changing the domain means
  updating all three.
- `ARCHIVE_SIGNING_KEY` (Production + Preview, sensitive): signs progress archives. Generated
  2026-10-08 with `openssl rand -base64 32` piped straight into `vercel env add`; it is not
  stored anywhere else. Replacing it only means older archives restore projects, not progress.
- Cloud content: `SUPABASE_DB_URL=<session pooler URL> npm run content:sync -- --target cloud`.
  The direct `db.<ref>.supabase.co` host is IPv6-only; use the session pooler
  (`postgres.<ref>@aws-0-us-east-1.pooler.supabase.com:5432`) with the URL-encoded password.

## Content (spec §44–45, §71)

Curriculum is data in `content/`: `skills.json`, `public/<id>/` (item.json, instructions,
starter code) and `private/<id>/` (contract with hidden expectations, curated hints, reference
solution). See `docs/CONTENT_REVIEW.md` for the review and publication rules.

```sh
npm run content:check                          # gate: static checks + reference passes / starter doesn't (Docker runner)
npm run content:check -- --provider vercel     # same, on Vercel Sandbox
npm run content:sync                           # load into the local database (one transaction)
SUPABASE_DB_URL=... npm run content:sync -- --target cloud
```

## Backups (spec §64)

Supabase Free has no automatic backups and pauses after 7 idle days. Owner-run:

```sh
SUPABASE_DB_URL=... npm run db:backup                         # writes backups/codequest-<time>.dump (git-ignored)
SUPABASE_DB_URL=... npm run db:restore -- --file <dump> --wipe-existing-data
```

Restore applies data onto a database that already has the migrations, wiping and reloading in
a single transaction — a failed restore leaves the existing data untouched.
