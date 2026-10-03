# CodeQuest

Personal Java interview-prep learning game (spec: `CodeQuest_Complete_Product_Specification.pdf`).
Next.js 16 + TypeScript on Vercel Hobby, Supabase Free, learner Java executed in Vercel Sandbox.

**Status: Phase 0 (feasibility).** No product UI yet. See `docs/REQUIREMENTS_MATRIX.md`.

- Setup: `docs/SETUP.md`
- Execution security model and known limitations: `docs/SECURITY.md`
- Quotas and measured costs: `docs/COSTS.md`

| Path | Purpose |
|---|---|
| `lib/execution/` | Source validation, executor, outcome classification, sandbox providers (Vercel, local Docker) |
| `runner/` | Pinned toolchain, trusted harness, snapshot preparation, proof/smoke fixtures and checker |
| `tests/unit/` | Vitest unit tests |
| `docs/evidence/` | Recorded proof-gate runs |
