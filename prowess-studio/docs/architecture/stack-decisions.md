# Stack Decisions — M0-WO1

Recorded per the user's explicit stack constraints for PAS-10. All versions
below are pinned exactly (no `^`/`~` ranges) for reproducibility, per
constraint #6.

| Concern              | Choice                     | Pinned version |
| -------------------- | -------------------------- | -------------- |
| Monorepo             | pnpm workspaces            | pnpm 9.15.9    |
| App framework        | Next.js (App Router), TS   | 16.3.6         |
| UI runtime           | React / React DOM          | 19.3.0         |
| Language              | TypeScript                 | 5.9.3          |
| Database              | PostgreSQL                 | 16.15 (sandbox test instance) |
| ORM / migrations      | Prisma                     | 7.10.0 (CLI/generation BLOCKED here — see docs/architecture/database.md) |
| Unit/integration tests| Vitest                     | 5.0.2          |
| E2E tests              | Playwright                 | 1.63.0         |
| Lint                   | ESLint (flat config)       | 9.39.5         |
| Env validation          | Zod                        | 4.6.5          |
| Env file loading         | dotenv                    | 18.0.4         |
| CI                      | GitHub Actions             | (M0-WO4)       |

## ESLint: 9.39.5 rather than 10.x

`eslint-config-next@16.3.6`'s plugin chain (`eslint-plugin-import`,
`eslint-plugin-jsx-a11y`, `eslint-plugin-react`) currently declares peer
ranges topping out at ESLint `^9` / `^9.7`. Installing ESLint 10 produced
unmet-peer-dependency warnings. 9.39.5 is the highest 9.x release and
resolves cleanly with zero peer warnings. Approved by the user for M0-WO1;
carried forward — do not force ESLint 10 until `eslint-config-next` (or its
plugin chain) raises its peer range.

## TypeScript: 5.9.3 rather than 7.0.2

TypeScript 7.0.2 (the native/Go-based compiler rewrite) is published to npm's
`prev`-adjacent stable line as of this build, but it is a very recent major
architectural rewrite. Next.js 16.3.6's own toolchain, `eslint-config-next`,
and `typescript-eslint` were verified against the 5.x line at time of
writing. To keep M0-WO1's acceptance criteria (install/build/dev
server/tests) on solid ground, this build pins TypeScript 5.9.3 (the last
5.x stable release) rather than adopting TS 7 immediately.

**Architecture question for review:** should a later Work Order evaluate and
migrate to TypeScript 7 once the Next.js/ESLint ecosystem confirms support,
or is 5.x acceptable to standardize on for the duration of Phase 1?

**Resolved (M0-WO2):** standardizing on TypeScript 5.9.3 for all of Phase 1.
No migration to TypeScript 7 during the foundational milestones; revisit
after Phase 1 stabilizes or once migrating offers a concrete benefit without
requiring experimental compatibility paths.

## Prisma: 7.10.0 rather than 8.x

Confirmed via the npm registry: `latest` dist-tag for `prisma`/`@prisma/client`
is `8.0.0-rc.17` (release candidate); `prev` is `7.10.0` (stable). Per the
explicit constraint, this build targets Prisma 7.10.0. Prisma itself is not
yet wired into the application — that begins in M0-WO3 (Database & Migration
Foundation) — but the version is recorded here now so it stays consistent
when that Work Order begins.

## Search

No dedicated search service is introduced in Phase 1. Per constraint #5,
search will be implemented directly against PostgreSQL (e.g. `tsvector`/
`pg_trgm`) behind a small abstraction, introduced alongside the Entity API
(M1-WO8) and Keyword Foundation (M1-WO5). No search code exists yet as of
M0-WO1.

## Package boundary enforcement

`@prowess/model` and `@prowess/ui` currently avoid a Next.js dependency by
convention and by `package.json` `dependencies`/`peerDependencies` shape
only (neither lists `next`). `apps/studio` transpiles both workspace
packages via `next.config.ts`'s `transpilePackages`, so they ship as plain
TypeScript source rather than requiring their own bundler step. Automated
enforcement (e.g. an ESLint rule that fails the build if `prowess-model` or
`prowess-rules` ever imports `next` or `react`) is recommended for M0-WO4
(Test & Quality Infrastructure) but is not yet implemented.

**Carried forward from M0-WO1 approval:** this remains a required item for
M0-WO4. In particular, framework-independent packages such as
`prowess-model` and future `prowess-rules`/`prowess-canon` packages must not
acquire Next.js dependencies — this should be enforced automatically, not
just by convention.

## M0-WO2: environment configuration

Schema and validation live in `apps/studio/src/config/` (`schema.ts` — the
Zod schema; `validate.ts` — the pure `validateEnv()` function and
`EnvironmentConfigError`; `load.ts` — file-based loading for non-Next
tooling; `index.ts` — the entry point). `next.config.ts` calls
`validateEnv(process.env)` directly and exits with a readable error on
failure; Next.js has already loaded the correct `.env.$(NODE_ENV)` file by
the time `next.config.ts` runs, so nothing else is needed there.

### DEVELOPMENT_MODE (required patch, approved)

`DEVELOPMENT_MODE` is a required, explicit boolean field on the schema —
`"true"` or `"false"` only, normalized to a real `boolean`, never inferred
from `NODE_ENV`. Malformed values (`"maybe"`, `"1"`, `"yes"`, `"TRUE"`,
empty string, etc.) fail validation with a message naming the variable and
the only two accepted literal values; JavaScript truthiness is never used.
It is part of the centralized `AppConfig` returned by both `validateEnv()`
and `getConfig()`, and it is server-only by construction: nothing in the
schema uses Next's `NEXT_PUBLIC_` client-exposure prefix, no `"use client"`
file references it, and `next.config.ts` does not forward it via an `env`
key — all three enforced by
`apps/studio/tests/unit/config-server-only.test.ts`, not left to
convention. See `schema.ts` for the full rationale on why this is a
separate concept from `NODE_ENV` (runtime environment vs. Prowess Studio's
own development/debug capabilities).

**`next.config.ts` cannot import arbitrary local relative TypeScript
modules the way application code can.** Next's `next-config-ts` feature
transpiles `next.config.ts` (and files it imports without an explicit
extension) individually — it does not run the project's full bundler
pipeline for it. Two concrete constraints followed from this, discovered by
trial and error against Next 16.3.6:
- Relative imports inside files reached from `next.config.ts` must **omit**
  the `.js` extension (i.e. `from "./schema"`, not `from "./schema.js"`),
  even though the rest of the codebase uses `moduleResolution: "Bundler"`
  and would accept either. An explicit `.js` extension is taken literally
  and fails to resolve to the sibling `.ts` file.
- A real npm/workspace package (resolved via `node_modules`, already built
  to plain JS) would work regardless of this quirk. We did not need to
  introduce one for M0-WO2 once the extension issue was found, but if a
  future Work Order's `next.config.ts` needs deeper local logic, packaging
  it as a small workspace package is the more robust option.

**`@next/env`'s `loadEnvConfig` is unsuitable for anything that flips
`NODE_ENV` more than once per process.** It snapshots `process.env` on its
first call and resets to that snapshot on every subsequent call before
re-deriving which files to load — correct for `next dev`/`build`/`start`
(which only ever run in one fixed mode for their whole lifetime) but wrong
for a test suite proving multiple environments' files load correctly in a
single run. `apps/studio/src/config/load.ts` therefore uses `dotenv`
directly (stateless, per-call file resolution mirroring Next's own
`.env.$(NODE_ENV).local` / `.env.local` / `.env.$(NODE_ENV)` / `.env`
precedence, with `.env.local` skipped for `test`) instead of `@next/env`.

**Committed vs. gitignored env files**, matching the acceptance criterion
"secrets are excluded from source control":
- `apps/studio/.env.development` and `.env.test` are committed. Both
  contain only non-secret, localhost-only placeholder values — this is
  what lets `pnpm install && pnpm dev` and the test suite work immediately
  for a fresh clone without any manual setup step.
- `apps/studio/.env.example` and `.env.production.example` are committed
  reference templates — never loaded automatically.
- A real `apps/studio/.env.production` (or any `.env.production.local`) is
  never created in this repository and is explicitly gitignored. Production
  configuration must come from the deployment platform's own secret store,
  or a gitignored `.env.production.local` for local production-mode
  testing. `apps/studio/playwright.config.ts`'s `webServer.env` supplies
  CI-safe, non-secret values as real process environment variables for the
  e2e production-mode boot — demonstrating exactly this pattern (secrets
  injected by the runner, not read from a committed file) — rather than
  requiring a committed production env file.

**Carried forward from M0-WO1 approval:** the Playwright e2e suite
(`apps/studio/tests/e2e/boot.spec.ts`) still could not be executed in this
sandbox (browser binary download blocked by network egress rules). M0-WO4
must demonstrate it actually executing successfully in the CI environment,
including the production-mode `webServer` boot path this Work Order added
`env` values for.

## Local environment-file policy (approved M0-WO2 patch)

`apps/studio/.env.development` and `apps/studio/.env.test` are committed to
source control. This is an explicit, approved exception to "don't commit
env files" made because both files are confirmed to contain **only
disposable, localhost-only configuration** — not because committing env
files is a general practice here. The policy going forward:

- A committed development/test environment file **may** contain safe
  localhost defaults: a `localhost`-only PostgreSQL connection string using
  a placeholder credential (e.g. `postgres:postgres`), a `localhost` app
  URL, a log level, and similar non-sensitive toggles like
  `DEVELOPMENT_MODE`.
- A committed development/test environment file **must never** contain:
  remote or shared-database credentials, API keys, access tokens,
  production secrets, or any other real secret — even a low-stakes one.
  "Safe to commit" is about the *value*, not the *file* — a `.env.test`
  file is not inherently safe just because it's for tests.
- **If a future development or test database becomes remote or shared**
  (a hosted Postgres instance, a shared staging database, etc.), its
  connection string must move out of the committed file immediately —
  into `.env.development.local` / `.env.test.local` (already gitignored
  via the `.env.*.local` pattern) or a proper secret-management solution.
  The committed `.env.development`/`.env.test` would at that point either
  be deleted or reduced to non-sensitive fields only, with the
  local/secret override file documented in `.env.example`.
- This same standard applies to any *new* variable added to the schema in
  future Work Orders: before adding its value to a committed file, ask
  whether it could ever hold a real secret. If yes, it belongs in a
  gitignored `.local` file or a secret manager from the start, regardless
  of which environment it's for.

## M0-WO3: database & migration foundation — APPROVED

Full details, the Prisma 7 breaking changes discovered, the canonical
migration, and the "Final verification requirements" checklist all live in
`docs/architecture/database.md` — this section just records the
version/dependency decisions specific to this Work Order.

- **`pg` (8.23.0) and `@prisma/adapter-pg` (7.10.0) are real (non-dev)
  dependencies of `@prowess/db`.** This is not `pg` replacing Prisma as the
  application's data-access layer — Prisma 7 requires a driver adapter for
  every database at runtime (see `docs/architecture/database.md`'s "Prisma
  7 requires a driver adapter" section), and `@prisma/adapter-pg` requires
  `pg` as an explicit peer, not a bundled transitive dependency. `pg` was
  originally added only for the temporary `sandbox-verification/` suite
  (raw SQL, no Prisma involved); that suite and its dependency on `pg`'s
  dev-only role are both gone now that `pg` has this different, permanent,
  Prisma-endorsed purpose instead.
- **PostgreSQL 16.15** (Ubuntu's `postgresql-16` package locally; GitHub
  Actions' `postgres:16` service-container image in CI) is what this Work
  Order actually ran against. No specific PostgreSQL version was mandated
  by PAS-10 beyond "PostgreSQL" generally — 16.x is a reasonable current
  default, but this isn't a hard pin the way the JS toolchain versions are.

## M0-WO4: test & quality infrastructure

Full details — the permanent CI workflow, architecture boundary rules,
troubleshooting, and what was/wasn't locally verifiable in this sandbox —
live in `docs/architecture/ci.md`. No new pinned dependency versions were
introduced for this Work Order: `scripts/check-architecture.mjs` (import
boundary + circular dependency enforcement) is plain Node, zero new
dependencies, chosen deliberately over a dedicated tool like
dependency-cruiser given how few and simple this repo's current boundary
rules are.

## M0-WO5: Studio Application Shell

Full details — shell structure, navigation, top bar, responsive behavior,
accessibility, and the active/placeholder route distinction — live in
`docs/architecture/studio-shell.md`. No new dependencies were introduced.
Three new presentational primitives were added to `@prowess/ui`
(`TopBar.tsx`, `NavToggle.tsx`, `InspectorPanel.tsx`) — React only, same
boundary as every existing `@prowess/ui` component. A real accessibility
bug was found and fixed during this Work Order (not merely written and
assumed correct): an initial draft used the native `hidden` attribute to
drive mobile-only nav visibility, which unconditionally removes content
from the accessibility tree at *every* width, not just mobile — caught by
the shell's own failing component tests, fixed with a CSS-only,
`data-mobile-open`-driven approach instead. See
`docs/architecture/studio-shell.md`'s "Responsive behavior" section for
the full explanation.
