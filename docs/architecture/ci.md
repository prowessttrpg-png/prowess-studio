# Continuous Integration

**Status: in service.** `Prowess Studio CI` (`.github/workflows/ci.yml`) is the verification authority for the project.
Since M5-CLOSEOUT-03 it is one workflow with a deliberate parallel job graph; the dedicated per-Work-Order workflows
(`m5-wo7.yml` … `m5-wo13.yml`) were retired after their unique checks moved into it
(`docs/reports/m0-m5-ci-optimization-report.md`).

## What runs, and when

The workflow runs:

- on every push to `main`;
- on every pull request (against any base branch);
- on demand via `workflow_dispatch` (Actions tab → "Prowess Studio CI" → "Run workflow"), optionally with
  `certification: true` for a Tier 3 clean certification run.

**Concurrency.** A pull-request run is cancelled when a newer commit is pushed to the same pull request (group
`ci-pr-<number>`). Every `main` push and every manual / certification run gets its own group (`ci-run-<run id>`), so a
`main` run always finishes authoritatively — a newer `main` commit never cancels it.

**No path filters.** Every run executes every job; no check is skipped because of which files changed.

## The job graph

```
static ─────────┐  lint · architecture boundaries · typecheck · gate inventory · control-harness self-test
unit-packages ──┤  model / ui / import / rules / db unit suites (concurrently)          ┐
unit-game ──────┤  @prowess/game unit suite                                            │ each suite runs ONCE and
unit-studio ────┤  Studio UI / component / static-audit suite                           │ writes its authoritative
db-api ─────────┤  Prisma validate · generate · migrate · drift · API integration ·      │ vitest JSON report
                │  guarded test-DB reset · safety-guard refusal                          │
db-integration ─┤  database integration, shard 1/2 and 2/2 (own PostgreSQL each)        ┘
                └──► controls-1 … controls-6  every named gate (below), then its controls
e2e                 one production build → Playwright against that build
tier-1              summary: static + unit-* succeeded          ("Tier 1 — fast feedback")
tier-2              summary: EVERY job succeeded                 ("Tier 2 — merge readiness" / "Tier 3 — clean certification")
```

Jobs that need a database each have their **own** disposable PostgreSQL 16 service container; no database is shared
between concurrent jobs. The workspace package build (`@prowess/model`, `ui`, `import`, `rules`, `game`, `db`) runs
in each job that needs it; the placeholder `@prowess/test-fixtures` package was removed in M5-CLOSEOUT-03 (R6) — it had
no tests, source beyond a version constant, or dependents.

### Named permanent gates

Every named gate of M1, M4-WO1 … WO12 and M5-WO1 … WO13 keeps its exact step name, in the same order, in one of the
`controls-*` jobs:

| Job | Gates |
|---|---|
| `controls-1` | M1 audit gate (static / database / API), M4-WO1 … WO11 audit gates, M4-WO10 integration gate, M4-WO12 final audit, M5-WO1, M5-WO2, M5-WO3 |
| `controls-2` | M5-WO4, M5 canon rulings, M5-WO5 |
| `controls-3` | M5-WO6, M5-WO7, M5-WO8, M5-WO9, M5-WO10 |
| `controls-4` | M5-WO11 |
| `controls-5` | M5-WO12 |
| `controls-6` | M5-WO13 |

A gate step does two things:

1. `node scripts/ci/verify-gate.mjs <GATE> <files…>` — verifies, from **this commit's** authoritative suite reports, that
   every test file of the gate passed (status, at least one passing assertion, no failure; complete-suite coverage for
   `allOf` gates such as M5-WO1's whole `@prowess/game` suite). The file list in the workflow must equal the gate's
   list in `scripts/ci/gates.json`, and a report from another commit is refused. The files are **not re-run**: the
   suite jobs already ran them once.
2. `PROWESS_EXPECT_CONTROLS=<n> node scripts/<gate>-negative-controls.mjs` — the gate's behavioural negative / mutation
   controls, with the exact control count pinned (the run fails if the inventory changes).

Each `controls-*` job is its own checkout, so controls of different jobs never mutate the same files concurrently;
inside a job they run sequentially.

### The permanent gate inventory

`scripts/ci/gates.json` lists every suite (job, report, include rule), every gate (test files, complete suites, control
script and count, smoke checks, the job and the workflow / step it ran in before CLOSEOUT-03) and every non-vitest check
(Prisma validate / generate / migrate / drift, lint, architecture, typecheck, guarded reset, safety-guard refusal,
production build, Playwright, game `dist` import smoke). `scripts/ci/legacy-inventory.json` is a frozen snapshot of
everything the pre-CLOSEOUT-03 workflows executed. `node scripts/ci/gate-inventory.mjs` — run in the `static` job and by
`apps/studio/tests/unit/ci-gate-inventory.test.ts` in the Studio suite — proves:

- old unique assertion inventory ⊆ new consolidated inventory (every legacy test file, suite, control script and
  command is represented; explicit retirements carry a reason);
- every gate is a named step of its job that verifies exactly its files and runs its controls with the exact count;
- every suite is run and collected in its job; every check command is present in its job;
- every control script belongs to exactly one gate.

### Controls harness

`scripts/lib/control-harness.mjs` runs every M5 control: one green baseline per **distinct** guard command on the
pristine tree, the mutation run (must fail for the control's own behavioural reason), restore in a `finally`, a
byte-for-byte check per control, and a whole-tree check (git status + bytes of every modified / untracked file
identical before and after). `scripts/lib/control-harness.selftest.mjs` (in the `static` job) proves the harness fails
on uncaught, misattributed, red-baseline, no-op, residue and inventory-change runs.

### Verification tiers

- **Tier 1 — fast feedback**: `static`, `unit-packages`, `unit-game`, `unit-studio`; summarized by the `tier-1` job.
  Useful early signal while developing; **not** merge certification.
- **Tier 2 — merge readiness**: every job; summarized by `tier-2`, which fails unless every job succeeded (a skipped or
  cancelled job fails it). Required before merge.
- **Tier 3 — clean certification**: the same workflow run manually with `certification: true` — no pnpm-store, browser
  or Next.js cache is restored, so every dependency, browser and build is produced cold. Used for milestone, release and
  major-architecture certification; it proves the Tier 1 / 2 caches hide nothing.

Any failing step fails its job, and the tier summaries fail with it — no step swallows a real failure.

## Gate history (what each milestone added)

The paragraphs below record what each milestone's gate contains. Before M5-CLOSEOUT-03 every gate re-ran its files
inside its own step; since then the same files are run once by their suite and the gate verifies them from the
authoritative reports (above), then runs its controls.

### The original M0-WO4 sequence (historical, one sequential job)

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
The follow-up Arcane ruling (M5-SC-011, M5-I153) extends the same step: it also runs `vocabulary.test.ts`, the static
audit pins the Arcane Rank (CANONICAL) / Arcana Rank (LEGACY) terminology entries, and two more controls revert the
ruling.

**M5-WO5 additions.** A sixth permanent named step, **"M5-WO5 audit — Shared modular ability construction"**, runs
right after the canon-rulings gate. It runs:

- the WO5 golden fixtures and contracts in `@prowess/game` (`construction-legality-golden.test.ts`,
  `construction-legality-contracts.test.ts`) and `vocabulary.test.ts` (Martial Rank and the construction terms);
- the static audit `apps/studio/tests/unit/m5-wo5-static.test.ts` (AST rules over the construction modules, structural
  rules over `ability-construction.json`, the M4 baseline, M5-I156–I158, terminology, the
  `m5-shared-ability-construction.md` sections and diagrams, and this step), with in-memory controls;
- the regenerated Rules Inspector fixture (`m5-wo5-inspector-fixture.test.ts`);
- exact Release history, isolation and no persistence against the real database (`prowess-construction-history.test.ts`);
- construction plans through the existing evaluate endpoint (`m5-wo5-construction-api.test.ts`);
- the behavioural negative controls `scripts/m5-wo5-negative-controls.mjs`.

The WO1, WO2 and WO4 catalog-length checks were raised from 155 to 158. No gate was removed.

**M5-WO6 additions.** A seventh permanent named step runs right after the M5-WO5 gate:
**"M5-WO6 audit — Targeting framework, geometry & branch catalogs"**. It runs:

- the WO6 golden fixtures and contracts in `@prowess/game` (`targeting-golden.test.ts`, `targeting-contracts.test.ts`) and
  `vocabulary.test.ts` (Trigger-Based / Glyph / Anchor as Targeting add-ons);
- the static audit `apps/studio/tests/unit/m5-wo6-static.test.ts` (AST rules over the Targeting modules, structural rules
  over `targeting.json`, no Targeting geometry math in Studio UI code, M5-SC-039 / M5-SC-040, the M4 baseline,
  M5-I159–I178, terminology, the `m5-targeting-framework.md` sections and diagrams, and this step), with in-memory
  controls;
- the regenerated Rules Inspector fixture (`m5-wo6-inspector-fixture.test.ts`);
- exact Release history, isolation and no persistence against the real database (`prowess-targeting-history.test.ts`);
- Targeting plans through the existing evaluate endpoint (`m5-wo6-targeting-api.test.ts`);
- the behavioural negative controls `scripts/m5-wo6-negative-controls.mjs`.

The WO1, WO4, WO5 and canon-rulings catalog-length checks were raised from 158 to 178, and the canon-rulings register
check now admits exactly the two new open conflicts (M5-SC-039, M5-SC-040). No gate was removed.
The post-WO4 rulings batch (M5-SC-007, M5-SC-013 to M5-SC-031, M5-SC-036; M5-I154, M5-I155) runs in the same step: the
static audit pins every ruling in the register, the two open follow-ups (M5-SC-037, M5-SC-038), the Size values (Huge
20, Massive 40) and the net-percentage cost fragment; the WO4 controls now forbid the superseded sequential cost model.

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

**Since M5-CLOSEOUT-03:** the `e2e` job builds the commit once (`pnpm build`, step "Build (production)") and runs
Playwright with `PROWESS_E2E_PREBUILT=1`, so `apps/studio/playwright.config.ts`'s `webServer` starts that build
(`next start`, refusing to start without its `.next/BUILD_ID`) instead of building the same commit a second time.
Locally, without the variable, the `webServer` still builds first. Chromium is cached per exact Playwright version
(`~/.cache/ms-playwright`; OS dependencies are always installed); Tier 3 certification restores no cache. CI keeps its
single existing retry; the two local flakes were fixed at their root cause (data-dependent nav-link locator; geometry
read before layout settled) — see `docs/reports/m0-m5-ci-optimization-report.md`.

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
- Since M5-CLOSEOUT-03 two more performance-only caches exist: Playwright's Chromium binaries (keyed on the exact
  Playwright version) and Next.js's own `.next/cache` (keyed on the lockfile, restored from the latest entry). Neither is
  a correctness requirement — a cold run works — and the Tier 3 `certification: true` run restores none of the three
  caches. Never cached: database state, Ruleset resolution, application runtime state.

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
- **Playwright failures** — in CI the `webServer` serves the build produced by the "Build (production)" step of the same
  job (`PROWESS_E2E_PREBUILT=1`); check that step's output first. Locally the `webServer` builds before starting.
- **A gate step fails in `verify-gate.mjs`** — the gate's own files did not pass (or did not run) in the suite job that
  owns them: open that suite job (`unit-*`, `db-api`, `db-integration`) for the real failure. A "file list differs from
  scripts/ci/gates.json" error means the workflow and the inventory were edited inconsistently.
- **`gate-inventory.mjs` fails** — a gate, suite, control script or check was added, renamed or removed without updating
  `scripts/ci/gates.json` (or a legacy check lost its replacement). Fix the inventory or the workflow; never delete the
  legacy snapshot entry.

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
