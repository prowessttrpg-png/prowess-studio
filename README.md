# Prowess Studio

Monorepo for the Prowess Platform — the internal Prowess Studio application and its framework-independent packages.
Implements the PAS-10 Work Orders against the architecture defined in PAS-01–PAS-09.

## Current milestone status

| Milestone | Status |
| --- | --- |
| M0 — Project Foundation | ✓ Complete |
| M1 — Entity & Version Core | ✓ Complete |
| M2 — Ruleset / Canon Governance | ✓ Complete |
| M3 — Source & Import Core | ✓ Complete |
| M4 — Rules Engine Foundation | Next |

Closure audits: `docs/audits/m1-completion-audit.md`, `docs/architecture/m2-final-audit.md`,
`docs/architecture/m3-final-audit.md`. The real-source validation of M3 is recorded in
`docs/import-reports/m3-wo9-core-playtest-v0.1.md`.

## Structure

```
apps/
  studio/                Next.js (App Router) Studio: the application shell, Compendium, Version History,
                         Ruleset & Canon governance (Developer → Rulesets), Import Studio (Developer → Import),
                         and the strict internal HTTP API (/api/...), all backed by @prowess/db.
packages/
  prowess-model/         Framework-independent domain types, vocabularies, validation and error codes.
  prowess-ui/            Shared Studio UI primitives (React only).
  prowess-import/        Pure M3 import logic: canonical JSON and fingerprints, the exact-version extractor
                         registry (structural and semantic-foundation extractors), the identity matcher, and
                         review / conflict helpers. No persistence, no UI.
  prowess-rules/         Pure M4 Rules Engine foundation: the four evaluation contexts, the common response
                         envelope, engine errors vs validation messages, the calculation trace and rule
                         provenance. Depends on @prowess/model only; no clock, randomness, network or persistence.
  prowess-db/            Centralized PostgreSQL / Prisma persistence boundary and the domain services
                         (Entities, Rulesets & Canon, Source & Import). Migrations live in
                         packages/prowess-db/prisma/migrations/.
database/
  migrations/            Pointer only — the canonical migrations are in packages/prowess-db/prisma/migrations/.
docs/
  architecture/          Component and milestone architecture documents (start with database.md, ci.md and the
                         m2 / m3 final audits).
  audits/                The M1 completion audit.
  import-reports/        Real-source import validation reports.
tests/                   Orientation for the test layers (suites live beside the code they test).
scripts/                 Repository tooling (architecture check, env loader, developer-only helpers).
```

Dependency direction (enforced by `pnpm run test:architecture`):
`@prowess/model ← @prowess/import ← @prowess/db ← apps/studio`, and `@prowess/model ← @prowess/rules ← @prowess/db`
(the pure Rules Engine, M4; @prowess/db's exact Ruleset resolver builds its contexts). Domain packages never depend on Next.js, Prisma or React; no package implements Prowess game mechanics yet —
M4-WO1 established only the engine's generic contracts (see docs/architecture/m4-rules-engine-core.md).

## Requirements

- Node.js >= 20 (developed against Node 22)
- pnpm >= 9 (`packageManager` pins the exact version)
- PostgreSQL 16 with two local databases, `prowess_studio_dev` and `prowess_studio_test` — see
  `docs/architecture/database.md` for setup.

## Getting started

```sh
pnpm install
pnpm db:generate         # generate the Prisma client (not run automatically on install)
pnpm db:migrate:deploy   # apply the migrations to the development database
pnpm dev                 # starts apps/studio on http://localhost:3000
```

## Common commands

| Command | Description |
| --- | --- |
| `pnpm build` | Build all workspace packages / apps |
| `pnpm lint` | Lint all workspaces |
| `pnpm typecheck` | Type-check all workspaces |
| `pnpm run test:architecture` | Package import-boundary and circular-dependency check |
| `pnpm test:unit` | Unit tests (Vitest) across workspaces |
| `pnpm test:e2e` | Playwright end-to-end tests for apps/studio |
| `pnpm db:generate` | `prisma generate` |
| `pnpm db:migrate:dev` | `prisma migrate dev` (development only) |
| `pnpm db:migrate:deploy` | `prisma migrate deploy` (production-safe) |
| `pnpm db:migrate:status` | `prisma migrate status` |
| `pnpm db:reset:test` | The only vetted way to reset the test database (refuses any non-`_test` target) |
| `pnpm import:source --file "<path>"` | Developer-only: ingest a local DOCX source through the M3 services (see the WO9 report) |
| `pnpm import:verify-real-source --file "<path>"` | Developer-only: re-verify a real source end to end |

CI (`.github/workflows/ci.yml`, described in `docs/architecture/ci.md`) is the verification authority: Prisma validate /
generate, the full migration chain from empty, a blocking drift check, architecture checks, lint, typecheck, unit,
database and API integration tests, the static audit gates, the production build and Playwright.

Pinned dependency versions and their reasoning: `docs/architecture/stack-decisions.md`.
