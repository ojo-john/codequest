# Content review and publication

Spec §44–45 and §71: content must be accurate, versioned and truthfully labelled. These rules are
enforced by `npm run content:check` (the content gate) and `npm run content:sync`.

## Status ladder

| Status | Meaning | Who sets it |
|---|---|---|
| `draft` | Written, not reviewed. Everything Claude drafts starts here. | author |
| `ai_reviewed` | Checked by an AI pass. **Not** equivalent to expert review. | author |
| `human_reviewed` | A named person read it and checked it against the spec and Java docs. Requires `reviewer` + `reviewedAt`. | the human reviewer |
| `published` | Visible to learners. Requires `reviewer` + `reviewedAt`. Immutable from here on. | the human reviewer |
| `deprecated` | Retired; existing attempts keep pointing at it. | the human reviewer |

Agent or automated review must never be recorded as human review.

## Gates every item passes before it can be synced

- Schema-valid; skill references exist; strict prerequisites acyclic; one item per campaign slot.
- Hints escalate `direction > pattern > key_insight > pseudocode > solution` without repeats.
- No expected values and no reference-solution lines in public files.
- The reference solution **passes** its contract under the pinned JDK (real runner).
- The starter compiles (unless `starterCompiles: false`) and does **not** already pass.

## Changing published content

A published version is frozen — payload, skill tags and hidden grading. To change it, bump
`version` in `item.json` (the new version starts as `draft`) and optionally deprecate the old one.
`content:sync` refuses any in-place change and rolls the whole sync back.

## Reviewing an item (owner)

1. Read `content/public/<id>/instructions.md` and the starter, solve it once yourself.
2. Read `content/private/<id>/private.json`: are the hidden cases fair given the instructions?
   Does every expected value match the instructions?
3. Read the `rubric` block in `private.json`: are the `edgeCases` really edge cases, does each
   follow-up question have exactly one defensible answer, and is its `why` correct?
4. Run `npm run content:check`.
5. Set `"review": { "status": "published", "reviewer": "<your name>", "reviewedAt": "YYYY-MM-DD" }`
   and run `npm run content:sync`.

## Reviewing an exercise set (owner)

Exercise sets (`kind: "exercise-set"`) keep questions in `content/public/<id>/item.json` and
answers, explanations and skill tags in `content/private/<id>/private.json`. For each question:
is there exactly one defensible answer, is the `why` right, and are the skill and dimension
apt? Predict-output answers are checked by running the code (`npm run content:check`).

## Awaiting review

Every quest and practice set outside the shopping cart is `draft`, written by Claude, and passed
the content gate. Each becomes visible without the drafts opt-in only after an owner review moves
it to `published`.

## Removed: the shopping cart campaign (2026-10-15)

At the owner's request the nine `campaign.shopping-cart` quests (`cart.q1-…` to `cart.q9-…`) are
`deprecated`: hidden from every learner, drafts opt-in or not, so the campaign no longer appears.
The files stay because deprecation is how content leaves the app: sync never deletes rows, and
learners' past attempts, XP and projects still reference these versions. Deprecated is final;
bringing the campaign back means new versions, not un-deprecating these.
