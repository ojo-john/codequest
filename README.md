# CodeQuest

Personal Java interview-prep learning game (spec: `CodeQuest_Complete_Product_Specification.pdf`).
Next.js 16 + TypeScript on Vercel Hobby, Supabase Free, learner Java executed in Vercel Sandbox
from a digest-pinned runner image.

**Status: Phase 0 (feasibility).** No product UI yet. See `docs/REQUIREMENTS_MATRIX.md`.

- Setup: `docs/SETUP.md`
- Execution security model and known limitations: `docs/SECURITY.md`
- Quotas and measured costs: `docs/COSTS.md`

| Path | Purpose |
|---|---|
| `lib/execution/` | Source validation, executor, JUnit + contract grading, admission control (job/CPU budget), sandbox providers (Vercel, local Docker) |
| `runner/` | Pinned toolchain, runner image (Dockerfile, trusted harness, contract runner), publish script, proof/smoke fixtures and checker |
| `tests/unit/` | Vitest unit tests |
| `docs/evidence/` | Recorded proof-gate runs |
