# Security

Scope: **owner-personal learning** (spec §65). This is not a public contest judge.

## Layers

| Layer | Where | What it enforces |
|---|---|---|
| Boundary validation | `lib/execution/source-files.ts` | ≤ 20 files, ≤ 200 KB UTF-8, relative `[A-Za-z0-9_-]` dirs + Java-identifier `.java` names, no `..`/`.`/absolute/backslash/NUL, no case-insensitive duplicates. Sources are (path, text) pairs — no archives or symlinks exist to unpack. |
| Admission control | `budget.ts`, `metered-executor.ts` | Daily/monthly job caps, monthly CPU-seconds budget with worst-case reservations, 1 active job per user, pause on provider quota exhaustion. |
| Fresh disposable VM | `vercel-sandbox-provider.ts` | Every job boots the digest-pinned runner image; `persistent: false`; no env vars, no app/DB credentials, no service-role keys inside. |
| Network | create | `networkPolicy: "deny-all"` (Docker: `--network none`). The image is built on the host from SHA-256-verified artifacts; no package manager or downloader runs in a sandbox. |
| Identity + capabilities | `runner/harness/run.sh` | Learner code runs as `learner`, through `setpriv` with **no capabilities**, a cleared bounding set and `no_new_privs`. The harness verifies `CapEff`/`CapBnd` are zero and **refuses to run** otherwise (exit 65 → infrastructure error). No `sudo` in the image. Harness, JDK and contract runner are root-owned and read-only. |
| Harness limits | `run.sh` | Positional args only. `ulimit -u 256` (processes + threads), `-f` 50 MB, no core dumps; `-Xmx256m`; inner `timeout --signal=KILL`; output truncated to 64 KB. JVM exit codes that collide with harness codes (64, 65) are remapped so learner code can't pose as an infrastructure error. |
| Deadlines | `java-executor.ts` | Per-command SIGKILL (wall + 5 s grace), 60 s overall lifetime AbortSignal, platform sandbox timeout; `stop()` always called after the job. |
| Grading | `contract.ts`, `outcome.ts` | **Hidden grading uses method contracts**: expected values never enter the sandbox; the trusted runner reports what learner code returned/threw and the server compares. JUnit mode reads the XML report **and** the JVM exit status; stdout is never parsed for results. Results/report read with `head -c 1 MB`. |

## Findings from the proof runs (2026-10-03)

1. **The Vercel exec agent grants full capabilities.** Commands run as uid `learner` but with
   every capability in the effective *and ambient* sets — effectively root (learner code read
   `/etc/shadow` and ignored `ulimit -u`). Fixed by the `setpriv` drop + verification above; the
   `privilege` smoke case asserts `CapEff` is zero from inside learner code.
2. **Snapshot restore costs ~8 s regardless of size**, while an image boots in ~0.7 s, so
   execution moved from a snapshot to a digest-pinned image (`docs/COSTS.md`).
3. **PID 1 can't be killed by learner code.** `kill -KILL 1` returns success but `sandbox-init`
   ignores it (`kill-init` smoke case).

## Known limitations (accepted, documented)

1. **JUnit-mode report forgery.** In JUnit mode, assertions share the JVM with learner code, so a
   shutdown hook can rewrite the report and `halt(0)` (the `report-forgery` smoke case
   "succeeds"). Therefore **JUnit mode is only for tests the learner can already see or wrote
   themselves** (visible samples, test-writing quests). Anything hidden — problem grading,
   project acceptance tests, mastery evidence — must use **contract mode**, where the same attack
   is graded wrong (`contract-forgery`, a required check).
2. **Contract inputs are visible** to learner code (it must receive them). Only expected outputs
   are secret; hidden cases resist memorisation, they are not cryptographic secrets.
3. **Heap cap ≠ memory cap.** `-Xmx` does not bound native/metaspace/thread memory; the VM's own
   memory (2 GB per vCPU) and the deadlines are the backstop.
4. **Local Docker runner** results are self-reported practice evidence, never a trusted cloud
   grade. Never expose the local runner as a network service.

## Sign-in (single owner)

- **No public sign-ups** (`[auth] enable_signup = false`, local and cloud; verified with live
  sign-up attempts returning `signup_disabled`). The only account is created by
  `npm run auth:create-owner`.
- Sign-in is an emailed magic link (PKCE): the code verifier cookie stays in the requesting
  browser, so a link only works there. Links expire after 10 minutes, at most one per minute.
- The sign-in form answers identically for known and unknown addresses (no account discovery).
- Identity is taken from a verified JWT (`getClaims`) in `lib/auth/dal.ts`; the proxy only
  refreshes the session and does an optimistic redirect. RLS is the final authority.
- Post-sign-in destinations go through `safeRedirectPath` (same-site paths only); redirects and
  email links are built from the configured app origin, never from request headers.
- Sign-out is a Server Action, so Next.js's origin check blocks cross-site sign-out.
- `tests/e2e/sign-in.spec.ts` drives the real flow in a browser against the local stack.

## Database access model (supabase/migrations)

| Data | Learner (authenticated) | Anonymous | Server (secret key) |
|---|---|---|---|
| Profile | read own; update only `timezone`, `target_role`, `settings` | — | full |
| Notes, reflections, recommendation feedback, projects | read/write own (reflections/feedback only on own attempts/recommendations) | — | full |
| Project files | read own; write only via `save_project_file()` (ownership, revision conflicts → HTTP 409, replay-safe, path/size limits) | — | full |
| Attempts, mastery evidence, skill state, XP, achievements, recommendations, sessions, execution jobs | **read own only** | — | full |
| Published content, skills, prerequisite graph | read | read | full |
| Draft content | — | — | full |
| Hidden grading (`private` schema), usage controls | — | — | SQL only (schema not exposed by the API) |

Enforced with RLS on every table **and** explicit grants (Supabase's default grants are
revoked first). Identity always comes from `auth.uid()`. Published content versions are
immutable (they can only be deprecated). Strict prerequisites must stay acyclic. XP is a ledger
unique per `(user, event_key)`, so reprocessing never double-awards. Ledger functions are
executable by the server role only.

`tests/integration/authorization.test.ts` covers this with two users and anonymous access; a
mutation check (deliberately leaking one policy and one grant) confirmed those tests fail when a
protection is removed.

## Export, import and deletion (lib/archive, lib/server/archive-service.ts)

- **Archives are signed, not secret.** `GET /api/v1/archive` returns everything the learner owns
  as readable JSON with an HMAC-SHA256 signature (key `ARCHIVE_SIGNING_KEY`, server-only, never in
  the browser) over a canonical serialisation, so re-formatting the file doesn't break it.
- **Trust on import.** Learner-authored data (projects, files, checkpoints, notes, preferences) is
  always restored. Grading-derived data (attempts, evidence, skill state, XP, sessions, hints,
  recommendations) is restored **only** when the signature verifies: an edited, unsigned or
  foreign-key archive restores code but no progress, so a learner can't award themselves XP or
  mastery by editing a file (spec §66). The UI says which happened.
- **No cross-account writes.** The importing user's id comes from the session; ids inside the
  archive never select an owner. Importing into another account remaps every row id to a UUIDv5
  scoped to that account. In SQL every child row (files, session items, evidence, reflections,
  feedback) is inserted only if its parent belongs to the importer, and every insert is
  `on conflict do nothing`, so a crafted archive naming another user's ids is skipped (tested).
- **Bounded input.** Uploads are capped at 4 MB compressed / 64 MB decompressed (decompression
  bombs rejected), every row is Zod-validated with per-table row caps, and project files pass the
  same path/size rules as saved code.
- **Deletion** (`DELETE /api/v1/data`) requires the typed phrase, runs in one transaction, keeps
  the account and profile, erases execution output but keeps job rows for quota accounting, and
  the page also clears this browser's IndexedDB drafts.
- `export_user_data`, `import_user_data` and `delete_user_data` are executable by the server
  role only (a signed-in learner calling them gets 42501; tested).
- **Key handling.** The production key exists only in Vercel (sensitive env var). Losing or
  rotating it means older archives restore projects and notes but no progress. Local dev uses a
  separate generated key (`npm run db:env`).

## Contract runner reflection rules

- Methods are resolved through **public, exported types** first (so a learner's `List.copyOf`
  result is used through `java.util.List`), and only learner classes (the unnamed module) are
  ever made accessible reflectively. JDK internals are never opened; an inaccessible member is a
  clean `missing_member` result, not a crash.
- A returned value that can't be represented as JSON is reported as `returned` +
  `unserializable`; it fails only where the contract expects a value, so learner objects can be
  bound and used by later steps.
- A step that throws doesn't stop its case (contracts can expect a throw and then check the
  object is unchanged); only a structural error (missing member, bad argument) skips the rest.

## Content gate (required before publishing a contract)

Every contract must pass against its reference solution under the pinned JDK (the
`contract-pass` proof case is the template). Because of this gate, a runtime `bad_argument` or
`unserializable` result is attributed to the learner (for example, a method returned `null` and a
later step used it), never reported as an infrastructure error.

## Verification

`npm run runner:local` (Docker) and `npm run runner:check` (Vercel) run 5 proof cases, 14
adversarial cases and a leftover-environment check, and write evidence to `docs/evidence/`.
The contract runner's own 24 JUnit tests run during every image build; a failure fails the build.
