# Continuous Integration — M0-WO4

**Status: workflow written, not yet verified by an actual GitHub Actions
run.** This document describes `.github/workflows/ci.yml`, the permanent
Phase 1 quality gate. See "Local verification performed" below for exactly
what was checked without a live run, and what still needs one.

## What runs, and when

**`Prowess Studio CI`** (`.github/workflows/ci.yml`) runs automatically:

- on every push to `main`;
- on every pull request (against any base branch);
- on demand via `workflow_dispatch` (Actions tab → "Prowess Studio CI" →
  "Run workflow").

There is exactly one job (`ci`), running every check in sequence. A single
job with clearly-named steps was chosen over splitting into several
parallel jobs: GitHub's Actions UI already shows each step's own pass/fail
status and name, which gives the same "which layer failed" clarity this
Work Order asked for, without the added complexity and duplicated
setup/install cost of multiple jobs. If CI runtime ever becomes a problem,
splitting into parallel jobs (e.g. a separate "database" job and a separate
"e2e" job) is the natural next step — nothing about this design prevents
that later.

## The sequence

1. Checkout
2. Set up pnpm (version read from `package.json`'s `packageManager` field)
3. Set up Node.js 22, with pnpm dependency caching
4. Wait for PostgreSQL to be ready (explicit `pg_isready` poll, distinct
   from the service container's own health check)
5. Create `prowess_studio_dev` and `prowess_studio_test` — two isolated,
   disposable databases, created fresh every run
6. Install dependencies (`pnpm install --frozen-lockfile`)
7. Prisma schema validation (`pnpm run db:validate`)
8. Prisma Client generation (`pnpm run db:generate`)
9. Deploy the canonical migration to `prowess_studio_dev`
10. Deploy the canonical migration to `prowess_studio_test`
11. Build workspace packages (`@prowess/model`, `@prowess/ui`,
    `@prowess/db`, `@prowess/test-fixtures`) — required before anything can
    resolve their compiled type declarations
12. Lint (`pnpm lint`)
13. Architecture boundary checks (`pnpm run test:architecture`)
14. Typecheck (`pnpm typecheck`)
15. Unit tests, package-level (`@prowess/model`, `@prowess/ui`,
    `@prowess/db`, `@prowess/test-fixtures`)
16. Database integration tests (`@prowess/db`'s real Prisma-backed suite,
    against `prowess_studio_test` only)
17. UI/component tests (`apps/studio`'s own unit test suite)
18. Guarded reset of the test database (`pnpm run db:reset:test`) — proves
    the destructive-reset safety guard still works on every CI run, not
    just at initial setup
19. Verify the same reset is refused when pointed at the development
    database (deliberately misconfigured `DATABASE_URL`)
20. Install Playwright's Chromium browser + OS dependencies
21. Production build (`pnpm build`, with disposable config env vars — see
    below)
22. End-to-end tests (`pnpm run test:e2e`) — boots a real production build
    and exercises `/`, `/compendium`, and `/developer`

Any step failing stops the run there with a non-zero exit, and GitHub
marks the whole workflow run failed — there is no step that swallows a
real failure.

## Local quality commands

| Command | What it does | Needs Postgres? |
| --- | --- | --- |
| `pnpm lint` | ESLint across every workspace | No |
| `pnpm run test:architecture` | Import-boundary + circular-dependency checks | No |
| `pnpm typecheck` | `tsc --noEmit` across every workspace | No* |
| `pnpm test:unit` | Unit tests across every workspace | No |
| `pnpm test:integration` | Real Prisma-backed tests for `@prowess/db`; no-op placeholders elsewhere | Yes (test DB) |
| `pnpm test` | `test:unit` + `test:integration` per workspace | Yes, for the `@prowess/db` portion |
| `pnpm build` | Builds every package, then `apps/studio` (needs `APP_URL`/`DATABASE_URL`/`LOG_LEVEL`/`DEVELOPMENT_MODE` — see M0-WO2) | No (shape-only) |
| `pnpm run test:e2e` | Playwright, against a real production build | No (shape-only) |
| `pnpm run db:generate` | `prisma generate` | No |
| `pnpm run ci` | `lint` → `test:architecture` → `typecheck` → `test` → `build`, in sequence — a local dry run of most of CI (not Postgres setup, not Playwright) | Yes, for the `test` portion |

\* `@prowess/db`'s own `typecheck`/`build` additionally require
`packages/prowess-db/generated/prisma/` to exist, which only
`prisma generate` produces — see "Sandbox limitations" below.

None of `pnpm test`, `test:unit`, or `test:integration` are destructive —
the only command that resets a database is `pnpm run db:reset:test`, and
only after its three-part safety guard confirms the target is genuinely
the isolated test database.

## Database requirements for integration tests

Two local PostgreSQL databases, matching exactly what `apps/studio`'s
`.env.development` / `.env.test` already expect (see M0-WO2 and
`docs/architecture/database.md`):

```sh
psql -h 127.0.0.1 -U postgres -c "CREATE DATABASE prowess_studio_dev;"
psql -h 127.0.0.1 -U postgres -c "CREATE DATABASE prowess_studio_test;"
pnpm run db:generate
pnpm run db:migrate:deploy   # NODE_ENV=development, then NODE_ENV=test
```

CI creates both fresh on every run via a disposable `postgres:16` service
container — never a shared or persistent database, never production
credentials.

## Playwright

The original Claude sandbox used for most of this project's development
could not download Playwright's browser binaries (network egress blocked
`cdn.playwright.dev`) — this was carried forward from M0-WO1 as an open
limitation. **GitHub Actions has normal internet access and is the
approved environment for this**: CI installs Chromium plus its OS
dependencies (`playwright install --with-deps chromium`) and then runs the
real suite (`apps/studio/tests/e2e/boot.spec.ts`) against an actual
production build, verifying `/`, `/compendium`, and `/developer` all render
correctly. This closes the M0-WO1 Playwright limitation — for real,
pending the first actual CI run (see "Sandbox limitations" below).

## Architecture boundary rules

Enforced by `scripts/check-architecture.mjs` (`pnpm run test:architecture`
— plain Node + regex over source text, zero new dependencies, chosen over
a dedicated tool like dependency-cruiser because this repo's rules are few
and simple enough that a short, readable script is easier to audit and
extend). Two things are checked:

**Forbidden imports, per package:**

| Package | May depend on | Must never import |
| --- | --- | --- |
| `@prowess/model` | nothing framework-specific | `next`, `react`, `react-dom`, `@prisma/client`, `@prisma/adapter-pg`, `prisma`, `pg`, `@prowess/db`, `@prowess/ui` |
| `@prowess/db` | Prisma, `@prowess/model` (not yet a real dependency, but permitted) | `react`, `react-dom`, `next`, `@prowess/ui` |
| `@prowess/ui` | React | `@prisma/client`, `@prisma/adapter-pg`, `prisma`, `pg`, `@prowess/db` |
| `apps/studio` (`app/`) | the packages below it | `@prisma/client`, `@prisma/adapter-pg`, `prisma` directly (must always go through `@prowess/db`) |
| `apps/studio` (`src/`) | the packages below it | same as `app/` — application-level modules (config, navigation) are held to the same standard |

**Circular workspace dependencies:** every workspace package's declared
`@prowess/*` dependencies are walked as a graph; any cycle fails the check
by name (e.g. `@prowess/model -> @prowess/db -> @prowess/model`).

This is a best-effort, regex-based static check — it catches the realistic
way these rules get violated (a wrong import statement), not every
conceivable workaround (e.g. a dynamically-constructed import specifier
string, or routing through a non-`@prowess/*` intermediate package). That
tradeoff is deliberate: it covers real mistakes with zero added tooling
complexity or dependencies.

**Verified for real, locally, in this sandbox** (not just written and
assumed to work):
- A deliberate forbidden import (`@prisma/client` added to
  `@prowess/model/src/index.ts`) was caught: exit code 1, with the exact
  file, line, and specifier named.
- A deliberate circular dependency (`@prowess/model` ⇄ `@prowess/db`) was
  caught: exit code 1, naming the full cycle.
- A deliberate forbidden import in `apps/studio/src/navigation.ts` (added
  during M0-WO5) was likewise caught: exit code 1, exact file/line/specifier
  named.
- All three were reverted immediately after confirming the failure — no
  broken test or deliberately-failing check was committed.

## Dependency reproducibility & caching

- `pnpm install --frozen-lockfile` in CI — fails loudly if `package.json`
  and `pnpm-lock.yaml` have drifted, rather than silently re-resolving.
- `actions/setup-node`'s built-in `cache: "pnpm"` caches the pnpm store
  keyed on the lockfile's hash — safe, standard, and does not cache
  anything that could make test results non-deterministic (no database
  state, no generated Prisma output, no build artifacts are cached).

## Environment configuration in CI

Uses the centralized M0-WO2 configuration system throughout — no ad hoc
parallel config. `DATABASE_URL` varies by step (`NODE_ENV=development` or
`NODE_ENV=test`, loaded via `scripts/with-env.mjs` exactly as locally).
The one exception is the production build step, which supplies
`APP_URL`/`DATABASE_URL`/`LOG_LEVEL`/`DEVELOPMENT_MODE` directly as real
process environment variables — because `next build` always forces
`NODE_ENV=production`, which does not load either committed `.env` file
(see M0-WO2). All values used are disposable, non-secret, and scoped to
the ephemeral CI database — no production secrets are needed or used.
`DEVELOPMENT_MODE`'s server-only guarantee (never exposed via
`NEXT_PUBLIC_*`, never read by a `"use client"` file) is unchanged by this
Work Order.

## Troubleshooting

- **"Cannot find module '../generated/prisma/client.js'"** (or similar,
  under `packages/prowess-db`) — expected if you haven't run
  `pnpm run db:generate` yet. Prisma's generated client is gitignored
  (never committed) and must be produced locally or in CI before
  `@prowess/db` can build/typecheck/test.
- **A `test:architecture` failure** names the exact file, line, and
  forbidden import (or the exact dependency cycle) — fix the import, don't
  adjust the rule, unless the architecture itself is deliberately changing
  (which should be its own reviewed decision, not a side effect of fixing
  a CI failure).
- **Postgres connection errors in CI** — check the "Wait for PostgreSQL to
  be ready" step's output first; if Postgres itself never became ready,
  every later database-dependent step fails for the same root reason.
- **Playwright failures** — `apps/studio/playwright.config.ts`'s
  `webServer` re-runs `pnpm run build` itself before starting the app
  (fast/incremental, since CI already built once); check that step's
  output, not just the test assertions, if a run fails unexpectedly.

## Sandbox limitations (unchanged from M0-WO3)

This development sandbox cannot reach `https://binaries.prisma.sh` or
`cdn.playwright.dev` — both of Prisma's CLI and Playwright's browser
binaries are unreachable here. GitHub Actions remains the approved
external verification environment for both, exactly as established in
M0-WO3. Everything in this CI workflow that depends on either — Prisma
generation/migration/integration tests, and the actual Playwright browser
run — could be written and locally reasoned about, but not executed, in
this sandbox. See "Local verification performed" below for the precise
boundary of what was and wasn't checked here.

## Local verification performed (this Work Order)

Confirmed locally, without needing Prisma generation or a live Postgres
instance:
- `pnpm run test:architecture` passes on the clean repository, and was
  proven to actually catch both a forbidden import and a circular
  dependency when deliberately (and temporarily) introduced.
- `pnpm lint` passes across every workspace.
- `.github/workflows/ci.yml`'s YAML is syntactically valid.
- Root `package.json` exposes every required command
  (`test`/`test:unit`/`test:integration`/`test:e2e`/`lint`/`typecheck`/
  `build`, plus `test:architecture` and `ci`).

**Not verified locally** (requires the GitHub Actions environment, exactly
as M0-WO3's Prisma operations did):
- The full CI workflow end-to-end, including Prisma generation/migration,
  the real database integration tests, and Playwright.
- `@prowess/db`'s own `typecheck`/`build` (blocked on the missing generated
  Prisma client — see "Sandbox limitations" above).

**M0-WO4 is not reported as a final `PASS` until the permanent
`Prowess Studio CI` workflow completes successfully on GitHub Actions at
least once.**

## M0-WO3 workflow retirement

`.github/workflows/m0-wo3-prisma-verification.yml` has been removed. Every
check it performed is now a permanent part of `ci.yml` above (schema
validation, generation, migration deploy to both databases, the guarded
reset and its dev-target refusal), plus several it never had (architecture
boundary enforcement, real Playwright execution, a dedicated production
build step, UI/component tests). No legitimate separate purpose remained
for keeping it, so per this Work Order's instruction it was deleted rather
than left alongside the permanent workflow.
