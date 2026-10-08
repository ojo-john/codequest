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
3. Run `npm run content:check`.
4. Set `"review": { "status": "published", "reviewer": "<your name>", "reviewedAt": "YYYY-MM-DD" }`
   and run `npm run content:sync`.

## Awaiting review (2026-10-07)

All nine `campaign.shopping-cart` quests (`cart.q1-…` to `cart.q9-…`) are `draft`, written by
Claude. Each passed the content gate on Docker and on Vercel Sandbox. They become visible to the
app only after an owner review moves them to `published`.
