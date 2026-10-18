# Continuous Integration — M0-WO4

**Status: in service.** This workflow has run on every approved Work Order since M0 and is the verification authority for the project. Earlier revisions of this document said it was "not yet verified by an actual GitHub Actions run"; that was true only at M0-WO4 authoring time and has long been resolved.

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

**M5-WO1 additions.** `@prowess/game` is built and unit-tested with the other workspace packages. A permanent named
step, **"M5-WO1 audit — Prowess domain & shared ability construction boundary"**, runs after the M4-WO12 final audit.
It re-runs and separately reports:

- `@prowess/game`'s suites;
- the static audit `apps/studio/tests/unit/m5-wo1-static.test.ts`;
- the legacy-terminology preservation unit test;
- exact Definition materialization against `prowess_studio_test`;
- `node scripts/m5-wo1-negative-controls.mjs`, which mutates real source for controls §214–§230, requires each one to
  be caught, and restores every file byte-for-byte.

**M5-WO2 additions.** A second permanent named step, **"M5-WO2 audit — Core resolution, stats, dice & ranks"**, runs
right after the M5-WO1 gate. It runs:

- the WO2 golden fixtures (§123–§142) and contracts in `@prowess/game`;
- the static audit `apps/studio/tests/unit/m5-wo2-static.test.ts` (AST rules over `@prowess/game` and
  `@prowess/rules`, structural rules over the canonical core content, the conflict register, terminology, invariants
  M5-I041–I074, documentation, the frozen M4 source-tree hash and the API route inventory in
  `docs/architecture/m5-wo2-baseline.json`, plus in-memory controls);
- the database test `prowess-core-resolution-history.test.ts` (exact Release R1 / R2 history and isolation);
- `node scripts/m5-wo2-negative-controls.mjs`, which mutates real source and content for controls §183–§200,
  requires each to be caught, and restores every file byte-for-byte.

No M0–M5-WO1 gate was replaced.

Every M0–M4 gate is unchanged.

**M5-WO3 additions.** A third permanent named step, **"M5-WO3 audit — Runtime resources, action economy & movement"**,
runs right after the M5-WO2 gate. It runs:

- the WO3 golden fixtures (§105–§125, §61) and runtime contracts in `@prowess/game`
  (`runtime-resources-golden.test.ts`, `runtime-contracts.test.ts`);
- the static audit `apps/studio/tests/unit/m5-wo3-static.test.ts` (AST rules over `@prowess/game` and
  `@prowess/rules`, structural rules over the canonical core and runtime content, the conflict register, terminology,
  invariants M5-I075–I110 and the superseded M5-I073, documentation, the frozen M4 source-tree hash and the API route
  inventory in `docs/architecture/m5-wo3-baseline.json`, plus in-memory controls);
- the fixture regeneration test `m5-wo3-inspector-fixture.test.ts`;
- the database test `prowess-runtime-resources-history.test.ts` (exact Release R1 / R2 history, isolation, and no
  persistence by evaluation);
- the API test `m5-wo3-runtime-api.test.ts` (WO3 plans and M4 explanations through the existing
  `POST /api/rules/evaluate`);
- `node scripts/m5-wo3-negative-controls.mjs`, which mutates real source, content and documentation for controls
  §174–§194, requires each to be caught, and restores every file byte-for-byte.

The M5-WO2 gate stays in place. Its Movement rule (M5-I073) is recorded as SUPERSEDED by M5-I075, and the WO2 control
§198 now pins the superseded state (10 × AGI is never canonical) instead of the old deferral. No gate was removed.

**M5-WO4 additions.** A fourth permanent named step, **"M5-WO4 audit — Affinity identity, rank, authority & keyword
alignment"**, runs right after the M5-WO3 gate. It runs:

- the WO4 golden fixtures (§175–§198) and Affinity contracts in `@prowess/game` (`affinity-golden.test.ts`,
  `affinity-contracts.test.ts`);
- the static audit `apps/studio/tests/unit/m5-wo4-static.test.ts` (AST rules over `@prowess/game` and `@prowess/rules`,
  structural rules over the canonical Affinity content and the amended Movement content, the conflict register,
  terminology, invariants M5-I111–I150 and the M5-I073 → M5-I075 → M5-I111 supersession chain, documentation, the frozen
  M4 source-tree hash and the API route inventory in `docs/architecture/m5-wo4-baseline.json`, plus in-memory controls);
- the fixture regeneration test `m5-wo4-inspector-fixture.test.ts`;
- the database test `prowess-affinity-history.test.ts` (exact Release R1 / R2 history, isolation, real M1 Keyword
  identity, and no persistence by evaluation);
- the API test `m5-wo4-affinity-api.test.ts` (Affinity plans and M4 explanations through the existing
  `POST /api/rules/evaluate`);
- `node scripts/m5-wo4-negative-controls.mjs`, which mutates real source, content and documentation for controls
  §243–§265, requires each to be caught, and restores every file byte-for-byte.

The M5-WO3 gate stays in place. Its Movement content rules were amended narrowly for the post-WO3 designer
clarification (Base Movement = authored 5 ft, Movement = Base Movement × AGI, Sprint = Movement × 4; M5-I075 SUPERSEDED
by M5-I111), and its controls now mutate the renamed `CREATURE_SIZE.baseMovement`. The WO2 / WO3 Rules Inspector
fixtures were regenerated: only derived-statistic `order` positions changed (the Movement dependency graph changed).
No gate was removed.

**Post-WO4 canon rulings additions.** A fifth permanent named step, **"M5 canon rulings audit — Size Base Movement &
Level 9 Affinity rank"**, runs right after the M5-WO4 gate. It runs the Size Base Movement goldens and contracts
(`runtime-resources-golden.test.ts`, `runtime-contracts.test.ts`, `core-resolution-golden.test.ts`), the Level 9
Affinity contracts (`affinity-contracts.test.ts`), and the static audit `apps/studio/tests/unit/m5-canon-rulings-static.test.ts`
(exact Size values, the M5-SC-033 / M5-SC-035 rulings appended to the register, the new M5-SC-036, the M5-I119 → M5-I151
supersession, M5-I152, documentation and this CI step). The M5-WO3 and M5-WO4 content rules were amended narrowly to
the rulings, and `scripts/m5-wo4-negative-controls.mjs` gained the canon-rulings controls (wrong Size values, a guessed
Massive value, a Size-blind compiler, a non-Trained or unresolved Level 9 Affinity, M5-SC-036 marked resolved). No gate
was removed.

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
| `@prowess/db` | Prisma, `@prowess/model`, `@prowess/import` (M3-WO2), `@prowess/rules` (M4-WO2: the exact Ruleset resolver builds its `RulesetContext`), `@prowess/game` (M5-WO1: exact Prowess Definition materialization) | `react`, `react-dom`, `next`, `@prowess/ui` |
| `@prowess/import` (M3-WO2) | `@prowess/model`, Node's standard library (`node:crypto`) | `@prowess/db`, `@prisma/client`, `@prisma/adapter-pg`, `prisma`, `pg`, `next`, `react`, `react-dom`, `@prowess/ui`, anything under `apps/studio` or `generated/prisma` |
| `@prowess/rules` (M4-WO1) | `@prowess/model` only | `@prowess/db`, `@prowess/import`, `@prowess/ui`, `@prowess/studio`, `@prowess/test-fixtures`, Prisma, `pg`, `next`, `react`, `react-dom`, Node built-ins (`node:*`, `fs`, `path`, `crypto`, `http`, `https`, `net`, `vm`, `child_process`, `worker_threads`), anything under `apps/studio`, `generated/prisma`, `prowess-db`, `prowess-import` or `prowess-ui`. Its purity rules (no clock, randomness, network, `eval`, game vocabulary or hidden-latest operations) are enforced separately by `apps/studio/tests/unit/m4-wo1-static.test.ts` |
| `@prowess/game` (M5-WO1) | `@prowess/model`, `@prowess/rules` (public entry points only) | `@prowess/db`, `@prowess/import`, `@prowess/ui`, `@prowess/studio`, `@prowess/test-fixtures`, Prisma, `pg`, `next`, `react`, `react-dom`, Node built-ins, deep imports into `@prowess/rules` / `@prowess/model`. Its purity and Prowess-boundary rules (no hidden math, latest lookup, randomness, clock, cross-branch coercion, Emission as canonical …) are enforced by `apps/studio/tests/unit/m5-wo1-static.test.ts` and `scripts/m5-wo1-negative-controls.mjs` |
| `@prowess/ui` | React | `@prisma/client`, `@prisma/adapter-pg`, `prisma`, `pg`, `@prowess/db` |
| `apps/studio` (`app/`) | the packages below it | `@prisma/client`, `@prisma/adapter-pg`, `prisma` directly (must always go through `@prowess/db`) |
| `apps/studio` (`src/`) | the packages below it | same as `app/` — application-level modules (config, navigation) are held to the same standard |
| `apps/studio` (`app/api/`) | `@prowess/db`'s bare public import only | same Prisma bans as `app/`, PLUS any *deep* import into `@prowess/db` internals (e.g. `@prowess/db/src/entity/repository.js`) — API route handlers are the final HTTP boundary (M1-WO8) and must use only the public service surface |
| `apps/studio` (`app/compendium/`) | the HTTP API only (via `fetch`) | `@prowess/db` entirely — bare or deep — plus the same Prisma bans as everywhere else; the Compendium frontend (M1-WO9) has no legitimate reason to import `@prowess/db` at all |

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
- A deliberate direct `@prisma/client` import, and separately a deliberate
  deep `@prowess/db/src/client.js` import, were each added to an API route
  file (M1-WO8) and confirmed caught by the new `apps/studio (app/api/)`
  rule specifically — the legitimate bare `@prowess/db` import every real
  route uses was confirmed to cause no false positive.
- A deliberate bare `@prowess/db` import (not just a deep one) was added
  to a Compendium page file (M1-WO9) and confirmed caught by the new
  `apps/studio (app/compendium/)` rule — unlike `app/api/`, even the bare
  import is forbidden here, since the Compendium has no legitimate reason
  to import `@prowess/db` at all.
- All were reverted immediately after confirming the failure — no broken
  test or deliberately-failing check was committed.

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

> **Historical — resolved (M1-WO11 documentation audit).** The limitation described below applied to the authoring sandbox only. Everything it left unverified locally (Prisma generation, migrations, database/API integration tests, the production build, Playwright) has since been exercised by the permanent CI workflow, which passed. The text is kept as the record of why earlier Work Orders reported local verification gaps.

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
