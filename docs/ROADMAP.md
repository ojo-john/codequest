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
| 2.5 Session mix and mixed mode | §5, §25 | Per-budget activity mix using exercises (5 min: flash questions + recognition + complexity; …); mixed mode with neutral names and hidden tags. |
| 2.6 Content: Data Structure Forge + Pattern Kingdom | §8, §9, §10 | Structure and pattern items and coding problems, with Pattern Hunter recognition. |
| 2.7 Readiness and dashboard | §40, §41 | Readiness separate from XP: breadth/depth, retention, unseen problems, assistance, with "insufficient evidence" instead of invented confidence. |
| 2.8 Debug dungeon, template memory, blank page, bosses, transfer | §11, §17, §53, §57, §59 | Built on the exercise engine and coding quests. |

## Phase 3+ (outline)

System design, LLD, interview communication, mocks, streaks/achievements, notifications,
search, cheat sheets — see the matrix. AI tutoring (§16) is Phase 4 and never overrides tests.
