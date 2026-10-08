# Requirements matrix (spec §71)

Maps every spec section to its phase, primary surfaces and acceptance check. Status is only
"Done" with linked evidence. Phases: **P0** feasibility · **P1** coding-comeback vertical slice ·
**P2** core Java/DSA curriculum + review loop · **P3** projects, system design, LLD, behavioral,
mocks · **P4** advanced ML + optional tutor.

| § | Requirement | Phase | Surfaces / entities | Acceptance check | Status |
|---|---|---|---|---|---|
| 1 | Product goal | all | — | Release gates (§68, §71) | Not started |
| 2 | Game structure, 11 worlds, skill DAG | P2 | `skills`, `skill_edges` | Strict-edge cycle check passes; worlds visible with unavailable scope marked | Not started |
| 3 | Adaptive diagnostic first launch | P2 | diagnostic flow, `attempts` | Placement changes path without skipping fundamentals | Not started |
| 4 | Daily home screen + time budget | P1 | `app/page.tsx` | 5/15/30/45/60+ choices create a session | **Done** — XP, reviews due, budget picker, campaign list with unreviewed labels (e2e) |
| 5 | Adaptive session engine | P1 | `lib/learning/session-planner.ts`, `create_session()` | Items fit budget; reasons cited; resumable | **In progress** — rules-v1 planner (reviews first, next quest as a resumable slice, reason codes recorded); session page with reasons, back-to-session links, completion on the last passing item, resume card on home (e2e) |
| 6 | Java curriculum | P2 | `content/public` manifest | Every listed topic present with review status | Not started |
| 7 | Big-O world | P2 | question types | Assumptions stated per item | Not started |
| 8 | Data structures | P2 | content | Per-structure checklist complete | Not started |
| 9 | Algorithms & patterns | P2 | content | Per-pattern minimums (§71) | Not started |
| 10 | Pattern Hunter | P2 | recognition items | Tags hidden in assessment mode | Not started |
| 11 | Template memory | P2 | blank editor | No snippets; graded on execution | Not started |
| 12 | Monaco editor | P1 | `components/workspace/*` | Run/submit/tests/reset-with-warning; AI off | **In progress** — multi-file Monaco (self-hosted assets), Run/Submit + shortcuts, confirmed reset, font size; custom tests (learner JUnit files, run alongside samples); Vim mode pending |
| 13 | Secure Java execution | P0→P1 | `lib/execution`, `runner/` | Proof + smoke suites pass on Vercel | **In progress** — gate passed on Docker + Vercel incl. capability drop and contract grading ([evidence](evidence/)); run/submit UI is P1 |
| 14 | Code grader rubric | P1 | `lib/grading` | Tests decide correctness; incomplete ≠ zero | **Done (rules-v1)** — `rubric-v1` with the spec's weights: correctness from hidden checks, edge cases from tagged checks, explanation + time/space complexity from follow-up questions with canonical answers; algorithm choice and code quality shown as *not assessed* (never zero); score over the assessed share; stored on the attempt and the job result (unit + integration + e2e). Reviewed reasoning for the rest: P4 |
| 15 | Hints (superseded by §70 for XP) | P1 | `hint_requests`, `/api/v1/quests/:id/hints` | Hint level recorded; no XP deduction | **Done (server)** — curated tiers served one at a time, recorded server-side, change independence only |
| 16 | Socratic AI tutor | P4 | optional | Server-side reveal policy | Not started |
| 17 | Debug Dungeon | P2 | content | Diagnosis + minimal fix + failing test | Not started |
| 18 | Code reading mode | P2 | question types | Predict-output items graded deterministically | Not started |
| 19 | Edge-case trainer | P2 | test-authoring UI | Learner tests executed | **In progress** — learners add JUnit test files (＋ Test file); Run shows their results; Submit grades them against the reference and planted-bug variants (quest 8: 6 mutants, all caught by reference tests in the content gate); testing-dimension evidence + XP from test quality. Checklist/selection mode P2 |
| 20 | Solution comparison | P2 | content | Claims account for copying/sorting impl | Not started |
| 21 | Mastery states per dimension | P1 | `mastery_evidence`, `user_skill_state` | Dimensions tracked separately | **In progress** — rules-v1 estimates per skill × dimension, insufficient evidence never "mastered" |
| 22 | Retrieval practice scheduler | P1 | ladder-v1 | Due-reason shown; version persisted | **In progress** — 1/3/7/14/30/60-day ladder, failures next day, assisted ≤ 3 days; scheduler version stored |
| 23 | Original problem bank | P1→P2 | `content_versions` provenance | Provenance + license on every item | Not started |
| 24 | Problem progression | P2 | sequencing rules | Remediation offered on missing prereq | Not started |
| 25 | Mixed mode | P2 | — | Neutral names; tags internal only | Not started |
| 26–30 | System design world, recognition, capacity, simulator, bosses | P3 | SD workspace, text alt to canvas | Reasoning graded vs requirements | Not started |
| 31 | LLD / OOD | P3 | content | Behaviour + extensibility graded | Not started |
| 32 | Practical Java world | P3 | projects | Contracts + tests per build | Not started |
| 33 | Interview communication | P3 | workflow prompts | — | Not started |
| 34 | Mock interviews | P3 | mock mode | Mode labelled honestly (§70) | Not started |
| 35 | Behavioral | P3 | STAR flows | No fabricated facts | Not started |
| 36 | XP | P1 | `xp_ledger` (unique `event_key`) | Repeated submission cannot duplicate XP | **Done** — keyed awards, tested twice-submitted and replayed jobs; the result shows exactly the XP newly earned (integration + e2e) |
| 37 | Streaks | P3 | timezone-aware | Freeze/vacation rules defined | Not started |
| 38 | Achievements | P3 | `achievement_awards` | Tied to independent evidence | Not started |
| 39 | Skill tree | P2 | React Flow + list view | Keyboard/screen-reader usable | Not started |
| 40 | Dashboard | P2 | progress page | Sample sizes shown | Not started |
| 41 | Readiness ≠ XP | P2 | readiness model | Easy grinding can't inflate readiness | Not started |
| 42 | Knowledge-graph data model | P0→P1 | migrations | Attempts reference immutable versions | **In progress** — schema + immutability triggers tested locally |
| 43 | Question types | P1→P2 | grading per type | Accessible interaction per type | **In progress** — multiple-choice follow-ups (radio groups with legends, keyboard-usable) graded deterministically; other types P2 |
| 44 | Content accuracy | P1 | content gate | Every example compiles on pinned JDK | **In progress** — `content:check` runs every reference and starter in the real runner (CI + Vercel); 9 quests |
| 45 | Content versioning | P0→P1 | `content_versions.status` | Scored versions never mutated | **In progress** — published versions immutable (trigger, tested); truthful review date enforced |
| 46 | Answer validation | P1 | `lib/grading` | AI cannot override failing tests | **Done (no AI yet)** — objective answers and executable tests graded deterministically; explanation/complexity evidence only from answers, never from code passing; no AI path exists to override tests. Disputes: n/a until subjective feedback (P4) |
| 47 | NFRs (perf, a11y, privacy) | P1→P3 | — | axe checks; targets defined w/ conditions | **In progress** — execution latency measured ~3–4.5 s warm on Vercel (target < 5 s); rest P1+; privacy: signed export, import, project ZIPs and confirmed deletion (`/data`) |
| 48 | Offline / interruption | P1 | Dexie drafts, revisions | Reload restores code; no silent discard | **In progress** — IndexedDB drafts, debounced saves with expected revisions, explicit conflict UI, offline retry with backoff, last result restored on reload (e2e: reload restores code) |
| 49 | Notifications | P3 | prefs | No guilt copy; quiet hours | Not started |
| 50 | Search | P3 | — | Personal data owner-scoped | Not started |
| 51 | Notes | P3 | `notes` | User statements not canonical | **In progress** — per-quest notes saved as typed, labelled as your own words and never checked (unit + integration + e2e); flashcards from notes P3 |
| 52 | Cheat sheets | P3 | content | Hidden in interview mode | Not started |
| 53 | Mastery exams | P2 | boss flows | Targeted remediation | Not started |
| 54 | Endgame mix | P3 | session policy | — | Not started |
| 55 | Interview-ready criteria | P3 | readiness | Minimum-evidence rule | Not started |
| 56 | Reflection card | P1 | `reflections` | Revisited as retrieval | **Done** — four versioned prompts after a passing submission, one per attempt (unique index); after 7 days the quest asks you to recall before revealing what you wrote (unit + integration + e2e) |
| 57 | Transfer tests | P2 | transfer families | Variants grouped; unseen metric honest | Not started |
| 58 | "Why not?" | P2 | question type | — | Not started |
| 59 | Blank-page mode | P2 | — | No templates | Not started |
| 60 | Learning loop | all | — | — | **In progress** — attempt → mastery (rules-v1) → review ladder → session planner, recorded in one transaction per graded submit |
| 61 | Personalisation / ML | P1 rules → P4 models | `recommendations` | Recommendations cite real history | Not started |
| 62 | Coding comeback track | P1→P3 | projects, multi-file workspace | Blank method → tested multi-class app | **In progress** — multi-file shopping-cart project workspace with revisioned saves; later campaigns P2+ |
| 63 | Stack | P0 | repo | Pinned versions + lockfile | **Done** — `package.json`, `.npmrc save-exact` |
| 64 | Free-tier limits & failure behaviour | P0→P1 | usage screen, job caps | Quota exhaustion pauses jobs, keeps code | **Done** — admission control (100/day, 2,000/month, CPU-seconds at 80 % of the 5 h quota, one active job, provider-quota pause) on the Supabase ledger; abandoned jobs (function died before settling) reclaimed after 5 min at their worst case; `/usage` screen with runs, compute and database size (unit + integration + e2e) |
| 65 | Execution proof gate | P0 | `runner/` | Image + deny-all + 2-file compile + JUnit + contract + smoke | **Done** — passed on Vercel 2026-10-03 (`evidence/vercel-all-2026-10-03T23-37-15-474Z.json`); image `runner/image-manifest.json` |
| 66 | Schema, RLS, transactions | P0→P1 | `supabase/migrations` | Two-user + anon authz tests | **Done** — 75 integration tests locally + CI; cloud project migrated and anonymous access smoke-tested 2026-10-06 |
| 67 | API contracts, job states | P1 | `app/api/v1/*` | Job state persisted before provisioning | **In progress** — sessions, quests, hints, executions (run/submit, idempotent job id), progress, preferences; structured errors + request ids; archive export/import, data deletion with typed confirmation, project ZIP |
| 68 | Setup deliverables | P0→P1 | `docs/`, CI | Fresh setup from guide works | **In progress** — docs + CI on private GitHub repo (all jobs green); production deployed 2026-10-08 at https://codequest-zeta-self.vercel.app with `main` auto-deploying; acceptance "export/import retains progress and projects" covered by integration (signed round trip restores every table) and e2e (download, erase, restore) |
| 69 | Playable shopping campaign | P1 | 9 quests | Each quest produces executable code | **In progress** — playable end to end (e2e: run, hint, submit, XP, reload); all 9 quests draft pending owner review |
| 70 | Supportive rewards, honest AI | P1 | — | No XP penalty for hints; modes labelled | **In progress** — no hint penalties; unreviewed content opt-in and labelled |
| 71 | Completion matrix + manifest | P0→P2 | this file, `content/` | Content checks reject broken refs/leaks | **In progress** — content gate + sync with immutability; curriculum manifest grows with each quest |
| 72 | Review record / risks | all | — | Risks tracked in SECURITY.md / COSTS.md | In progress |
