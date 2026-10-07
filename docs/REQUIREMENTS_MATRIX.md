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
| 4 | Daily home screen + time budget | P1 | home page | 5/15/30/45/60+ choices create a session | Not started |
| 5 | Adaptive session engine | P1 | `lib/learning/session-planner.ts`, `create_session()` | Items fit budget; reasons cited; resumable | **In progress** — rules-v1 planner (reviews first, next quest as a resumable slice, reason codes recorded); UI pending |
| 6 | Java curriculum | P2 | `content/public` manifest | Every listed topic present with review status | Not started |
| 7 | Big-O world | P2 | question types | Assumptions stated per item | Not started |
| 8 | Data structures | P2 | content | Per-structure checklist complete | Not started |
| 9 | Algorithms & patterns | P2 | content | Per-pattern minimums (§71) | Not started |
| 10 | Pattern Hunter | P2 | recognition items | Tags hidden in assessment mode | Not started |
| 11 | Template memory | P2 | blank editor | No snippets; graded on execution | Not started |
| 12 | Monaco editor | P1 | workspace UI, Zustand | Run/submit/tests/reset-with-warning; AI off in interview mode | Not started |
| 13 | Secure Java execution | P0→P1 | `lib/execution`, `runner/` | Proof + smoke suites pass on Vercel | **In progress** — gate passed on Docker + Vercel incl. capability drop and contract grading ([evidence](evidence/)); run/submit UI is P1 |
| 14 | Code grader rubric | P1 | `lib/grading` | Tests decide correctness; incomplete ≠ zero | **In progress** — correctness layer done: contract grading (hidden expectations server-side) + JUnit; rubric weighting P1 |
| 15 | Hints (superseded by §70 for XP) | P1 | `hint_requests`, `/api/v1/quests/:id/hints` | Hint level recorded; no XP deduction | **Done (server)** — curated tiers served one at a time, recorded server-side, change independence only |
| 16 | Socratic AI tutor | P4 | optional | Server-side reveal policy | Not started |
| 17 | Debug Dungeon | P2 | content | Diagnosis + minimal fix + failing test | Not started |
| 18 | Code reading mode | P2 | question types | Predict-output items graded deterministically | Not started |
| 19 | Edge-case trainer | P2 | test-authoring UI | Learner tests executed | Not started |
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
| 36 | XP | P1 | `xp_ledger` (unique `event_key`) | Repeated submission cannot duplicate XP | **Done (server)** — keyed awards, tested twice-submitted and replayed jobs |
| 37 | Streaks | P3 | timezone-aware | Freeze/vacation rules defined | Not started |
| 38 | Achievements | P3 | `achievement_awards` | Tied to independent evidence | Not started |
| 39 | Skill tree | P2 | React Flow + list view | Keyboard/screen-reader usable | Not started |
| 40 | Dashboard | P2 | progress page | Sample sizes shown | Not started |
| 41 | Readiness ≠ XP | P2 | readiness model | Easy grinding can't inflate readiness | Not started |
| 42 | Knowledge-graph data model | P0→P1 | migrations | Attempts reference immutable versions | **In progress** — schema + immutability triggers tested locally |
| 43 | Question types | P1→P2 | grading per type | Accessible interaction per type | Not started |
| 44 | Content accuracy | P1 | content gate | Every example compiles on pinned JDK | **In progress** — `content:check` runs every reference and starter in the real runner (CI + Vercel); 9 quests |
| 45 | Content versioning | P0→P1 | `content_versions.status` | Scored versions never mutated | **In progress** — published versions immutable (trigger, tested); truthful review date enforced |
| 46 | Answer validation | P1 | `lib/grading` | AI cannot override failing tests | Not started |
| 47 | NFRs (perf, a11y, privacy) | P1→P3 | — | axe checks; targets defined w/ conditions | **In progress** — execution latency measured ~3–4.5 s warm on Vercel (target < 5 s); rest P1+ |
| 48 | Offline / interruption | P1 | Dexie outbox, revisions | Reload restores code; no silent discard | **In progress** — server side done: `save_project_file()` revision conflicts + replay-safe mutation ids (tested); client outbox P1 |
| 49 | Notifications | P3 | prefs | No guilt copy; quiet hours | Not started |
| 50 | Search | P3 | — | Personal data owner-scoped | Not started |
| 51 | Notes | P3 | `notes` | User statements not canonical | Not started |
| 52 | Cheat sheets | P3 | content | Hidden in interview mode | Not started |
| 53 | Mastery exams | P2 | boss flows | Targeted remediation | Not started |
| 54 | Endgame mix | P3 | session policy | — | Not started |
| 55 | Interview-ready criteria | P3 | readiness | Minimum-evidence rule | Not started |
| 56 | Reflection card | P1 | `reflections` | Revisited as retrieval | Not started |
| 57 | Transfer tests | P2 | transfer families | Variants grouped; unseen metric honest | Not started |
| 58 | "Why not?" | P2 | question type | — | Not started |
| 59 | Blank-page mode | P2 | — | No templates | Not started |
| 60 | Learning loop | all | — | — | Not started |
| 61 | Personalisation / ML | P1 rules → P4 models | `recommendations` | Recommendations cite real history | Not started |
| 62 | Coding comeback track | P1→P3 | projects, multi-file workspace | Blank method → tested multi-class app | Not started |
| 63 | Stack | P0 | repo | Pinned versions + lockfile | **Done** — `package.json`, `.npmrc save-exact` |
| 64 | Free-tier limits & failure behaviour | P0→P1 | usage screen, job caps | Quota exhaustion pauses jobs, keeps code | **In progress** — admission control (job caps, CPU-seconds budget, provider-quota pause) done with in-memory ledger; Supabase ledger + usage screen P1 |
| 65 | Execution proof gate | P0 | `runner/` | Image + deny-all + 2-file compile + JUnit + contract + smoke | **Done** — passed on Vercel 2026-10-03 (`evidence/vercel-all-2026-10-03T23-37-15-474Z.json`); image `runner/image-manifest.json` |
| 66 | Schema, RLS, transactions | P0→P1 | `supabase/migrations` | Two-user + anon authz tests | **Done** — 75 integration tests locally + CI; cloud project migrated and anonymous access smoke-tested 2026-10-06 |
| 67 | API contracts, job states | P1 | `app/api/v1/*` | Job state persisted before provisioning | **In progress** — sessions, quests, hints, executions (run/submit, idempotent job id), progress, preferences; structured errors + request ids |
| 68 | Setup deliverables | P0→P1 | `docs/`, CI | Fresh setup from guide works | **In progress** — docs + `.github/workflows/ci.yml` (no remote repo yet) |
| 69 | Playable shopping campaign | P1 | 9 quests | Each quest produces executable code | **In progress** — all 9 quests authored (104 hidden contract cases; references pass, starters fail, on Docker and Vercel); draft status awaiting owner review; UI pending |
| 70 | Supportive rewards, honest AI | P1 | — | No XP penalty for hints; modes labelled | **In progress** — no hint penalties; unreviewed content opt-in and labelled |
| 71 | Completion matrix + manifest | P0→P2 | this file, `content/` | Content checks reject broken refs/leaks | **In progress** — content gate + sync with immutability; curriculum manifest grows with each quest |
| 72 | Review record / risks | all | — | Risks tracked in SECURITY.md / COSTS.md | In progress |
