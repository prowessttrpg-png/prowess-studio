# Prowess Studio

Monorepo for the Prowess Platform. Implements PAS-10 (M0/M1 Work Orders)
against the architecture defined in PAS-01–PAS-09.

## Structure

```
apps/
  studio/               Next.js (App Router) application — routes, pages,
                         server/API integration, application state.
packages/
  prowess-model/        Framework-independent shared domain types
                         (identifiers, status/relationship enums).
  prowess-ui/            Shared Studio UI primitives (React only).
  prowess-db/            Centralized PostgreSQL/Prisma persistence boundary.
                         See docs/architecture/database.md — Prisma's CLI
                         is currently BLOCKED in some sandboxed
                         environments; read that doc before assuming
                         `pnpm db:*` commands will just work.
  prowess-import/        Framework-independent, import-specific pure logic (M3-WO2):
                         canonical JSON, ImportBatch / ExtractionCandidate
                         fingerprints, source-scope helpers. Depends only on
                         @prowess/model; used by @prowess/db.
  prowess-test-fixtures/ Shared test fixtures/factories (placeholder in M0).
database/
  migrations/            Reserved — the real migrations live in
                         packages/prowess-db/prisma/migrations/ once
                         generation is unblocked; this top-level folder is
                         a placeholder from M0-WO1.
docs/
  architecture/          Stack decisions and architecture notes, including
                         database.md (persistence setup, the Prisma
                         blocker, and its verification checklist).
tests/                   Reserved for cross-package integration/e2e suites.
```

Architectural rule: `prowess-model` and future domain packages
(`prowess-rules`, `prowess-canon`, …) must never depend on Next.js, Prisma,
or any other framework/database client. `apps/studio` hosts the
application; `prowess-db` hosts persistence; neither owns Prowess
mechanics, and the dependency direction is `prowess-model <- prowess-db <-
apps/studio`, never the reverse.

## Requirements

- Node.js >= 20 (developed against Node 22)
- pnpm >= 9 (`packageManager` field pins the exact version)
- PostgreSQL (developed against 16.x) with two local databases —
  `prowess_studio_dev` and `prowess_studio_test`. See
  `docs/architecture/database.md` for exact setup steps and for the
  current Prisma CLI network blocker some sandboxes hit.

## Getting started

```sh
pnpm install
pnpm dev            # starts apps/studio on http://localhost:3000
```

`pnpm install` does not run `prisma generate` automatically (see
`docs/architecture/database.md` for why) — the persistence layer
(`@prowess/db`) is not yet wired into `apps/studio`, so this doesn't block
running the app.

## Common commands

| Command              | Description                                   |
| -------------------- | ---------------------------------------------- |
| `pnpm build`          | Build all workspace packages/apps              |
| `pnpm lint`           | Lint all workspaces                            |
| `pnpm typecheck`      | Type-check all workspaces                      |
| `pnpm test`           | Run each workspace's default test script       |
| `pnpm test:unit`      | Run unit tests (Vitest) across workspaces      |
| `pnpm test:e2e`       | Run Playwright e2e tests for apps/studio       |
| `pnpm db:generate`     | `prisma generate` (see database.md — BLOCKED in some sandboxes) |
| `pnpm db:migrate:dev`  | `prisma migrate dev` (development only)        |
| `pnpm db:migrate:deploy` | `prisma migrate deploy` (production-safe)    |
| `pnpm db:migrate:status` | `prisma migrate status`                      |
| `pnpm db:reset:test`     | The only vetted way to reset the test database (guarded — see database.md) |

See `docs/architecture/stack-decisions.md` for pinned dependency versions
and the reasoning behind them, and `docs/architecture/database.md` for
everything persistence-related.
