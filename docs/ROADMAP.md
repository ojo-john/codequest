# Roadmap

Phase status lives in `REQUIREMENTS_MATRIX.md`; this file is the build order for what's left.
Each slice ships as its own PR, leaves `main` deployable, and comes with unit, integration and
(where there is UI) e2e and accessibility coverage.

## Phase 1 — coding-comeback vertical slice: complete

Everything except the owner's content review (`CONTENT_REVIEW.md`). Deferred from §12: Vim
mode (the Monaco vim plugin expects the npm build of Monaco; ours is self-hosted AMD) and the
optional timer (lands with interview mode, §34).

## Phase 2 — DSA core

| Slice | Spec | What ships |
|---|---|---|
| 2.1 Exercise engine ✅ | §43, §46, §18, §58 | A second content kind, `exercise`: short, deterministically graded items — single/multi choice, true/false, predict output, Big-O, pattern recognition (optimal / valid / incorrect), order steps, fill-in. Canonical answers stay server-side; each type has a defined grader and an accessible interaction. Attempts and evidence reuse the learning-loop tables. |
| 2.2 Worlds and the skill tree ✅ | §2, §39 | Worlds 0–5 in `skills.json`; a skill tree page (accessible list view first, graph second) with per-dimension estimates, last practice, next review, prerequisites (strict vs recommended) and recommended tasks. |
| 2.3 Content: Java Awakening + Complexity Caverns ✅ | §6, §7 | Exercise sets for World 1 (Java fluency) and World 2 (Big-O detective: loops, doubling, triangular nesting, recursion, space). |
| 2.4 Base Camp diagnostic ✅ | §3 | An adaptive first-launch diagnostic (~10 Java items, rising Big-O items, structure scenarios, pattern recognition, one easy implementation). Placement seeds skill estimates as low-weight evidence and picks the starting path without skipping fundamentals. |
| 2.5 Session mix and mixed mode ✅ | §5, §25 | Per-budget activity mix using exercises (5 min: flash questions + recognition + complexity; …); mixed mode with neutral names and hidden tags. |
| 2.6 Content: Data Structure Forge + Pattern Kingdom ✅ | §8, §9, §10 | Structure and pattern items and coding problems, with Pattern Hunter recognition. |
| 2.7 Readiness and dashboard ✅ | §40, §41 | Readiness separate from XP: breadth/depth, retention, unseen problems, assistance, with "insufficient evidence" instead of invented confidence. |
| 2.8 Debug dungeon, template memory, blank page, bosses, transfer ✅ (first content) | §11, §17, §53, §57, §59 | Built on the exercise engine and coding quests. |

## Phase 3 — interview breadth

| Slice | Spec | What ships |
|---|---|---|
| 3.1 System Design City: concepts and recognition ✅ | §26, §27, §28 | Concept practice sets (networking, performance, scaling, storage, caching, queues, consistency); scenario-to-component recognition graded optimal/valid/incorrect with "a cue is not proof" explanations; a numeric question type for capacity estimates (value, unit, stated tolerance and assumptions). |
| 3.2 Design workspace ✅ (text-first; canvas later) | §29, §30, §59 | A text-first structured design workspace (requirements, APIs, data model, components, trade-offs, calculations) with a requirements checklist and follow-up probes (growth, fan-out, cache failure, duplicates); graded against requirements, not one drawing. Canvas later, always with a text alternative. |
| 3.3 Low-level design ✅ (first content) | §31 | Behaviour-graded OOD quests (vending machine, parking lot, …) plus change requests that test extensibility rather than pattern names. |
| 3.4 Practical Java ✅ (single-threaded components; concurrency next) | §32 | LRU/TTL cache, rate limiter, thread-safe counter, producer/consumer, key-value store, job queue: explicit contracts, meaningful tests, concurrency caveats stated. |
| 3.5 Interview communication and mocks | §33, §34 | A workflow mode (clarify → examples → brute force → optimize → code → test → complexity) and timed mock sessions that hide study aids and hints, scored on the rubric with evidence; any hire-style label stated as a practice rubric, not a prediction. |
| 3.6 Behavioral | §35 | A STAR story workspace for the learner's true stories, with a checklist; never fabricates achievements or metrics. |
| 3.7 Streaks and achievements | §37, §38 | Timezone-aware streaks kept by a meaningful 5-minute session, two freezes a month, vacation/busy-week modes, supportive copy; achievements tied to independent evidence. |
| 3.8 Utilities | §49–52, §54, §55 | Notification preferences (no guilt copy), search, flashcards from notes, versioned cheat sheets hidden in interview mode, endgame session mix, configurable interview-ready criteria with minimum evidence. |

AI tutoring (§16) is Phase 4 and never overrides tests.
