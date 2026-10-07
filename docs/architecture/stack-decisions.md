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

## M1-WO1: Base Entity Model

Full details — what an Entity is/isn't, canonical-key format, EntityType,
repository/service responsibilities, error vocabulary — live in
`docs/architecture/entity-model.md`. No new dependencies were introduced.
`@prowess/db` now has a real (non-workspace-only-in-theory) dependency on
`@prowess/model` for the first time — the Entity service imports its
`EntityId`, `EntityType`, `CanonicalKey`, `DomainError`, and
`ENTITY_ERROR_CODES` — matching the already-approved dependency direction
(`prowess-model <- prowess-db`), not a new architectural decision.

## M1-WO2: Entity Version Model

Full details — revision numbering/allocation, concurrency strategy, status
field scope, structured_data purpose, parent lineage, snapshot behavior,
and the EntityVersion error vocabulary — live in
`docs/architecture/entity-version-model.md`. No new dependencies were
introduced. The revision-allocation concurrency strategy (bounded retry on
a Postgres unique-constraint race, max 5 attempts) was chosen deliberately
over heavyweight distributed-lock infrastructure, per the Work Order's own
explicit guidance, and is exercised by a dedicated integration test — but
that test, like every other `@prowess/db` integration test in this
project, could not actually be executed in this sandbox (missing generated
Prisma client); it is reasoned-through and locally type/lint-clean, not
locally run. See the completion report's "Local Verification" and
"Sandbox Limitations" sections for the precise boundary.

## M1-WO3: Entity Status & Immutability Rules

Full details — the lifecycle graph, mutation policy, always-immutable
fields, the atomic conditional-update strategy, error codes, and the
CANON-vs-Ruleset-authority distinction — live in
`docs/architecture/entity-version-lifecycle.md`. No new dependencies were
introduced. A documentation correction from M1-WO2 is also recorded here:
`entity-version-model.md`'s original "each persisted EntityVersion is a
self-contained, immutable snapshot" phrasing conflated historical
independence (always true) with mutability (true only for DRAFT) — fixed
in both the markdown doc and the `@prowess/model` source's own doc
comment, per this Work Order's explicit instruction.

## M1-WO4: Entity Aliases & Canonical Keys

Full details -- normalization strategy (NFC not NFKC, and why), the
deliberate normalized-context-key schema strategy that avoids PostgreSQL's
NULL-is-distinct-from-NULL uniqueness pitfall, duplicate/ambiguity policy,
and the error vocabulary -- live in
`docs/architecture/entity-alias-model.md`. No new dependencies were
introduced. `toDomainEntity` was promoted from a private helper to an
exported (but still package-internal, not part of `@prowess/db`'s public
`index.ts`) function in `entity/repository.ts`, so `entity-alias/
repository.ts`'s alias-to-Entity join query could reuse the exact same row
mapping rather than duplicating it -- a small, deliberate exception to
"repository internals stay fully private," scoped to same-package reuse
only.

### M1-WO4 patch: locale-independent alias normalization

`normalizeEntityAlias` originally used `.toLocaleLowerCase()` with no
explicit locale, which is host-default-locale-dependent and therefore
non-deterministic across developer machines, CI, and deployments for a
value that gets persisted as a database lookup/uniqueness key. Fixed to
`.toLowerCase()` (locale-independent Unicode lowercasing). No other part
of the normalization sequence, schema, duplicate/context architecture, or
service surface changed. See `entity-alias-model.md`'s "Normalization"
section for the full explanation, including the classic Turkish-locale
`"I"` -> `"ı"` example this fix avoids.

## M1-WO5: Keyword Foundation

Full details -- the core "no implicit mechanics" rule, KeywordCategory/
KeywordDefinition, why two explicit relational assignment models instead
of one polymorphic target_type+target_id table, assignment source types,
the Version-lifecycle interaction (and its atomic SELECT...FOR UPDATE
guard across two tables), reverse lookup, and the full error vocabulary --
live in docs/architecture/keyword-model.md. No new dependencies were
introduced. The M0-WO1 placeholder `KeywordId` branded type was renamed to
`KeywordDefinitionId` (matching this Work Order's exact spec'd naming) and
a new `KeywordCategoryId` was added alongside it -- confirmed unused
anywhere before renaming. `toDomainEntityVersion` was promoted from a
private helper to an exported (but still package-internal) function in
entity-version/repository.ts, following the exact same reuse pattern
already established for `toDomainEntity` (M1-WO4) and
`toDomainKeywordDefinition` (this Work Order) -- each reused by the
reverse-lookup join queries in entity-keyword/ and
entity-version-keyword/.

## M1-WO6: Entity Relationships

Full details -- the stable-identity-only scope and why version-specific
relationships are deferred, the no-unstated-mechanics principle, directed
single-row storage with no automatic inverse, duplicate/self-reference
policy, metadata's non-authoritative-for-mechanics rule, and why typed
subsystem joins will exist separately later -- live in
docs/architecture/entity-relationship-model.md. No new dependencies were
introduced. M0-WO1's placeholder `RelationshipId` was renamed to
`EntityRelationshipId` (matching this Work Order's exact spec'd naming),
following the same pattern already used for `KeywordId` ->
`KeywordDefinitionId` in M1-WO5 -- confirmed unused anywhere before
renaming. The existing `RelationshipType` enum from M0-WO1 already
contained exactly the Phase 1 vocabulary this Work Order needed and
required no changes at all. A new small `JsonValue`/`JsonObject` type was
added to @prowess/model (no shared JSON-compatible type existed yet) for
relationship metadata, reusable by any future domain type with the same
need.

## M1-WO7: Source Reference Foundation

Full details -- why SourceReferences attach to EntityVersion rather than
stable Entity, no automatic propagation between revisions, the
descriptive-only authority vocabulary (matching PAS-08's Canon Manager
spec exactly), file_reference's provider-agnostic design, the deliberate
lack of a duplicate-prevention constraint on source_references, and why
provenance attachment is NOT gated by DRAFT/CANON lifecycle status -- live
in docs/architecture/source-provenance-model.md. No new dependencies were
introduced. SourceDocumentId and SourceReferenceId already existed with
the exact names this Work Order needed (an M0-WO1 placeholder that, unlike
KeywordId/RelationshipId in M1-WO5/WO6, required no renaming). The
SourceAuthorityStatus vocabulary was sourced directly from the existing
PAS-08 Canon Manager specification already present in this project's
reference documents, not independently invented, confirmed by searching
for it before writing any code.

## M1-WO8: Entity API

Full details -- the complete HTTP status mapping with its reasoning, pagination/
filter semantics (including the two stated M1-WO8 scope limitations: Entity-level-
only keyword filtering, and the status-filter pagination cost tradeoff), the
latestRevision convention, the no-auth Phase 1 scope, and the architecture
enforcement extension -- live in docs/architecture/api-layer.md. apps/studio
gained its first real dependency on @prowess/db. This is the first Work Order
where that dependency's consequences became directly visible from the
application side: apps/studio's production build now fails locally (it
bundles against @prowess/db's stale dist/, frozen since before the Prisma-
generation blocker existed), confirmed to be a sandbox artifact and not a
code defect via a temporary, reverted tsconfig.json path override that
typechecked every route handler's actual @prowess/db calls against real
source. A new @prowess/db query service, listEntities, was added
specifically to back GET /api/entities -- the one genuinely new piece of
backend logic this Work Order required, deliberately avoiding Prisma's
distinct+orderBy interaction (unverifiable without a working generated
client) in favor of a plain, fully-inspectable JS reduction for latest-
revision resolution.

### M1-WO8 patch: exhaustive, fail-closed DomainError-to-HTTP mapping

The centralized DomainError->HTTP status map originally defaulted an
unmapped future error code to 400, which conflated "the client sent bad
input" with "the server shipped a new error code without choosing its
HTTP status" -- the latter is an application contract omission, not client
error. Fixed: the map is now built with `satisfies
Record<KnownDomainErrorCode, number>`, where `KnownDomainErrorCode` is
derived directly from @prowess/model's own `*_ERROR_CODES` constants, so
adding a new domain error code without adding a matching HTTP-status entry
is now a TypeScript compile error. At runtime, any code that still
reaches the boundary unmapped (should be unreachable given the compile-time
check, but defended anyway) fails closed to a generic 500
`INTERNAL.UNEXPECTED_ERROR`, never a 400 and never exposing the original
code. No endpoint, pagination, filter, service behavior, schema, or route
structure changed. See `docs/architecture/api-layer.md`'s "HTTP status
mapping" section for the full explanation.

## M1-WO9: Entity Browser UI

Full details -- the API-only architecture, search/filter/pagination/URL-
state semantics, the latestRevision terminology rule, the detail-page
section-by-section design, the N+1-avoidance decision for SourceDocument
titles (client-side parallel fetch rather than a backend change), and why
Ruleset/current-version selection is still absent -- live in
docs/architecture/compendium-ui.md. No new dependencies were introduced.
Five new presentational primitives were added to @prowess/ui
(EntityTypeBadge, VersionStatusBadge, KeywordChip, EmptyState, Pagination)
-- all text-labeled by construction, never color-only, satisfying the
accessibility requirement directly rather than as an afterthought. A real,
caught-and-fixed issue along the way: the newer react-hooks/
set-state-in-effect lint rule flagged the standard data-fetch-on-mount
pattern used by both Compendium pages; resolved with narrow, justified
eslint-disable comments rather than a disproportionate rewrite into a
heavier data-fetching architecture (React Query/SWR) this project doesn't
otherwise use. pageSize was made URL-configurable on the list page
specifically so automated tests could exercise pagination without needing
20+ fixtures, per the Work Order's own explicit allowance for this.

## M1-WO10: Version History UI

Full details -- the `?revision=` URL strategy (and why not `/versions/:id`),
Latest-vs-Selected terminology, real-`parentVersionId` lineage, the
stable-vs-version-scoped data split, comparison mode and its limits, the
deliberate absence of lifecycle-event history -- live in
docs/architecture/version-history-ui.md. No new dependencies; no backend or
API change. Revision content is taken from the Entity's Version list (which
already returns full snapshots) instead of refetching each Version.
`resolveSourceDocuments` gained an optional shared cache so revisions citing
the same document cost one request. M1-WO9's LatestRevisionSection was
generalized to RevisionSection, and an existing M1-WO9 Playwright heading
assertion was tightened to `exact: true` since "Latest Revision" is a
substring of the "Latest Revision Keywords" heading.

## M1-WO11: Integration & Historical Reproducibility Audit Gate

No product feature, schema change, or migration. Added a four-layer audit
(static / database / API / browser), three named CI gate steps, and an
informational Prisma drift step. Full record: `docs/audits/m1-completion-audit.md`;
architecture summary: `docs/architecture/m1-entity-version-core.md`.
Decisions worth keeping: (1) the drift check is deliberately non-blocking
because Prisma cannot run in the authoring sandbox and static review found a
probable real mismatch (migrations declare `DEFAULT gen_random_uuid()`, the
schema uses client-side `@default(uuid())`) — a schema decision is left to a
human per the Work Order's stop-and-report rule; (2) a private helper's
`errorCode: string` was tightened to `RelationshipErrorCode`, and the static
audit now forbids uncontrolled codes reaching `DomainError`; (3) canonical
keys cannot contain hyphens, so the audit uses `historical_rule`.

## M1-WO11 final patch: schema/migration drift resolved (F-1, F-13)

The first real CI run's Prisma drift check **confirmed** F-1 and found one more mismatch (F-13).
Decision: align `schema.prisma` to the already-approved migrations — the nine UUID ids become
`@default(dbgenerated("gen_random_uuid()"))`, and `EntityVersion.updatedAt` becomes
`@default(now()) @updatedAt`. Rejected: a new migration dropping the defaults (adds a migration to a
milestone meant to add none, and removes a useful safety net for raw inserts) and accepting the drift
(every future `migrate dev` would generate noise). **No new migration, no data migration, no history
rewrite.** Consequence recorded: PostgreSQL, not Prisma Client, now generates those ids. The drift
step is now a **blocking** gate that invokes Prisma directly (pnpm's recursive runner flattens every
failure to exit 1, which had made the step mislabel drift as "the command failed" — F-14). This
supersedes the earlier "deliberately non-blocking" decision recorded under M1-WO11. M1 is not yet
marked approved; that waits on the final CI run.

## M2-WO1: Ruleset foundation

Identity and lifecycle only; full design in `docs/architecture/ruleset-foundation.md`. Decisions
worth keeping: (1) a Ruleset holds NO content and references no Entity/EntityVersion — the
manifest (M2-WO2) will pin versions explicitly, and nothing is ever derived from latest revision,
CANON, revision number, or Source authority; (2) `RulesetStatus` is its own vocabulary, not
`EntityVersionStatus` (they overlap on five labels but mean different things); (3) creation is
always DRAFT — no caller-supplied status; (4) parent lineage is creation-time metadata with no
update API, but the cycle check is built and tested now so any future parent-changing operation
inherits it; INVALID_PARENT and PARENT_CYCLE stay distinct for diagnostic value; (5) the Ruleset
error codes were added to the central compile-time-exhaustive HTTP map even though no route exists
(verified: leaving them out is a type error); (6) the M1 database conventions were followed exactly
from the first commit so the blocking drift gate stays green. No new dependency; no HTTP route; no UI.

## M2-WO2: Ruleset manifest and EntityVersion pinning

Full design in `docs/architecture/ruleset-manifest.md`. Decisions worth keeping: (1) a manifest is an
immutable snapshot of exact (Entity, EntityVersion) pins; there is no entry mutation and no current /
active / published manifest, and nothing is inferred from latest revision, lifecycle status, Source
authority, Keywords, relationships, or a parent Ruleset; (2) the "Version belongs to Entity" invariant
is enforced by the database through a COMPOSITE foreign key (needing one extra unique index on
`entity_versions(id, entity_id)`), not only by the service; (3) consequently no separate foreign key
to `entities` and no `Entity.manifestEntries` back-relation — chosen over two overlapping relations on
one column, which the toolchain could not be shown to accept; (4) no CHECK constraint for
`manifest_version > 0` — M1 has none and nothing yet shows how Prisma's blocking drift check treats
them; positivity comes from the allocator and is pinned by tests; (5) manifest_version allocation
reuses M1's bounded-retry strategy with unique(ruleset_id, manifest_version) as final authority;
(6) one error namespace `RULESET_MANIFEST.*` for every manifest failure, with HTTP statuses recorded
in the compile-time-exhaustive map before any route exists. No new dependency, enum, route, or UI.

## M2-WO3: Ruleset inheritance and effective resolution

Full design in `docs/architecture/ruleset-inheritance.md`. Decisions worth keeping: (1) a child
manifest inherits through an EXACT `parent_manifest_id`, never the parent Ruleset's latest manifest, so
creating newer parent manifests cannot change an existing child — and resolution lives in a separate
module that has no way to look up a Ruleset or a latest manifest, which a static audit enforces;
(2) Ruleset lineage and manifest inheritance are deliberately not the same thing: a manifest with no
parent manifest inherits nothing even when its Ruleset has a parent; (3) the parent manifest must
belong to the DIRECT parent Ruleset and is validated by the service — a database-level proof would need
redundant keys and was rejected as disproportionate; (4) effective composition is derived, never
persisted, and ordered by asking the database (its collation is the M2-WO2 ordering convention, which a
JavaScript comparison would not reproduce); (5) the resolution trace is a domain-only type, not a
Prisma enum; (6) INHERITANCE_CYCLE maps to HTTP 500 deliberately — it is corrupt data, not a caller
error. The earlier local manifest operations are unchanged. No new dependency, table, enum, route, or UI.

## M2-WO4: Canon policy and source authority

Full design in `docs/architecture/canon-policy-source-authority.md`. Decisions worth keeping: (1) a
CanonPolicy is an immutable, Ruleset-scoped snapshot; to change source authority create policy N+1 —
there is no mutation and no active/current policy pointer, and "latest" means only highest policy_version;
(2) `SourceDocument.authorityStatus` (descriptive provenance on the document) and `SourceAuthorityRecord`
(Ruleset-scoped governance) are distinct facts that are never copied or synchronized; (3) the existing
`SourceAuthorityStatus` enum is reused, so there is no second authority vocabulary to drift; (4) scope keys
use a narrow validator — the literal `global` plus the existing canonical-key grammar — because that grammar
requires two segments and rejects `global`, and weakening it for everyone was the worse choice;
(5) resolution is exact scope -> global -> UNRESOLVED inside ONE policy, with UNRESOLVED derived and never
stored, and no fallback across policies or to a parent Ruleset's policy; (6) policy code is structurally
barred from selecting content: it imports only its own repository plus Ruleset and SourceDocument existence
lookups, and a static audit forbids EntityVersion selection, manifest, inheritance, status, keyword, and
relationship identifiers; (7) records are ordered by scope_key then source_document_id, because a
SourceDocument's title is not unique; (8) a missing SourceDocument gets its own code in the new namespace
(a body reference, not an addressed resource); (9) no CHECK constraint for policy_version > 0, following M1.
No new dependency, enum, route, or UI.

## M2-WO5: Rule conflicts

Full design in `docs/architecture/rule-conflicts.md`. Decisions worth keeping: (1) a RuleConflict RECORDS a
disagreement and never resolves it — no winner, resolution, or decision column exists, and M2-WO6's
CanonDecision will own outcomes; (2) a conflict is Ruleset-scoped and single-Entity, and is NOT tied to a
CanonPolicy (the decision will record the policy snapshot it relied on); (3) candidates pin exact
EntityVersion ids, so later revisions never join a conflict; (4) "the candidate Version belongs to the
conflict's Entity" is enforced by the DATABASE through a redundant `rule_conflict_candidates.entity_id`
pinned by two composite foreign keys (to the conflict and to the Version), which makes the copy impossible
to diverge — the redundancy buys real integrity, so it was taken; (5) cited SourceReference evidence is
likewise a composite key on (source_reference_id, entity_version_id), which needs one new unique index on
`source_references` and is skipped by PostgreSQL when no reference is cited; (6) at least two and at most 25
candidates — the minimum spans rows, so it lives in the service transaction, not a trigger; (7) every
conflict starts OPEN and there is no transition operation, though the full status vocabulary (including
ACCEPTED_DIVERGENCE) is declared now; (8) type and severity are classification only, and a static audit
forbids branching on their values; (9) candidates are ordered by revision ascending then id — a display
order, never a ranking; (10) RULESET_NOT_FOUND is 404 (the addressed resource, as for manifests and
policies) while every body-reference and shape error, including DUPLICATE_CANDIDATE, is 400. No new
dependency, route, or UI.

## M2-WO6: Canon decisions

Full design in `docs/architecture/canon-decisions.md`. Decisions worth keeping: (1) a CanonDecision is an
immutable record of an explicit outcome — it never applies itself to a manifest, lifecycle, policy or
Ruleset, and the ONLY existing row it changes is its conflict's status; (2) type (what was done) and
disposition (how the conflict ended) are separate vocabularies, with the legal combinations and selection
counts in one data table type-checked against both; ACCEPTED_DIVERGENCE is reachable only via KEEP_SEPARATE;
(3) every decision pins one exact conflict and one exact policy, and the Ruleset is derived from the conflict;
(4) same-Ruleset, same-Entity (MERGE result) and same-conflict (selections) are enforced by composite foreign
keys, via redundant `entity_id` / `rule_conflict_id` columns pinned so they cannot diverge, plus three PK-led
target indexes on existing tables; (5) race safety comes from running a conditional
`UPDATE … WHERE status IN ('OPEN','UNDER_REVIEW')` FIRST in the transaction, so PostgreSQL's row lock
serializes deciders and the loser matches zero rows — no read-then-insert window, no distributed lock;
(6) no `UNIQUE(rule_conflict_id)`, so future rollback/supersession can add history — the lifecycle
transition, not a constraint, enforces "one decision" today; (7) the transition is internal; there is no
public conflict-status setter; (8) pure validation runs before database lookups (it reveals nothing about
stored state), a reordering of the WO's suggested sequence; (9) no `summary` field — the required rationale
is the single audit text; (10) RULESET_NOT_FOUND was added to the vocabulary for `listCanonDecisions`;
CONFLICT_NOT_FOUND is 404 (the addressed subject) while POLICY_NOT_FOUND is 400 (a body reference). No new
dependency, route, or UI.

## M2-WO7: ChangeSets and impact analysis

Full design in `docs/architecture/change-sets-impact-analysis.md`. Decisions worth keeping: (1) decision,
ChangeSet and application are three separate stages — deciding creates no ChangeSet, creating one applies
nothing, and no apply/execute operation exists; (2) a ChangeSet is an immutable DRAFT snapshot, revised only
by creating another; the other four statuses are vocabulary for M2-WO8; (3) the operation matrix is one data
table, and every Version reference is an exact id; (4) operations keep the author's order via an explicit
`sequence`, because rows from one transaction share `created_at`; (5) contradictions are a deliberately small
rule set — NO_CHANGE alone, one manifest-composition operation per Entity, no duplicate CREATE/DEPRECATE, no
deprecating a Version being pinned; (6) `target_manifest_id` records ANALYSIS context, never an edit — applied
composition changes will create a new manifest; (7) decision translation is a pure function behind an
explicit service call; it uses M2-WO3 effective resolution so inherited pins produce a child-manifest
override, never a parent edit; KEEP_SEPARATE, RESOLVE_CONFLICT and DISMISSED map to NO_CHANGE; (8) impact is
derived and never persisted, labelled `derivation: "LIVE"`, and means "review may be required"; relationships
are walked one hop, inheritance transitively; one item per (category, resource) with all reasons; (9)
same-Ruleset decision/manifest and same-Entity Versions are composite foreign keys via a redundant
`ruleset_id` on operations; (10) OPERATION_CONFLICT is 400 (a contradiction inside one request). The audit
work also fixed a latent regex gap in the M2-WO6 static audit (a `\b` after `(` meant `.update({` never
matched); both audits now carry control cases. No new dependency, route, or UI.

## M2-WO8: Ruleset publishing and immutable releases

Full design in `docs/architecture/ruleset-publishing-releases.md`. Decisions worth keeping: (1) publication
is the ONLY boundary from approved proposal to release state and creates new rows — a flattened, parentless
release manifest and an immutable release that pins manifest, policy, ChangeSet, number, label, channel and
hash; (2) review transitions are explicit expected-state conditional updates of status only; APPROVED ->
PUBLISHED happens only in publication; (3) the M1 EntityVersion lifecycle and the M2-WO2 manifest allocator are
REUSED inside the publication transaction by threading an optional transaction client through the same
functions (defaults unchanged) — neither "stop" condition was triggered; (4) operations fail closed
(STALE_CHANGE_SET), CREATE is never materialized (409), DEPRECATE is lifecycle-only and never changes
composition; (5) all publications of a Ruleset serialize on `SELECT … FOR UPDATE` of the Ruleset row, release
numbers are previous+1 under that lock with UNIQUE as the final authority, and unique races retry the whole
transaction (bounded); (6) release history is linear — later releases must base on the previous release's
manifest; (7) the hash is SHA-256 of a versioned canonical text (PROWESS_MANIFEST_V1) over composition only,
computed in @prowess/db so the model stays runtime-neutral; (8) one release per ChangeSet (UNIQUE), no
current/active release pointer, `getLatestRulesetRelease` is a query; (9) two codes beyond the WO list:
RULESET_RELEASE.INVALID_INPUT and INVALID_CHANGE_SET_CONTEXT. The pre-existing M0-WO5 `/publishing`
placeholder route is pinned by the static audit as an unchanged placeholder until M2-WO10.

## M2-WO9: Ruleset & Canon HTTP API

Full reference in `docs/architecture/ruleset-canon-api.md`. Decisions worth keeping: (1) 31 route files / 38
handlers, each a thin adapter — shape validation, one public `@prowess/db` call, `serializeForApi`, the central
error map — with no Prisma/repository import and no domain logic (pinned by `m2-api-static`, mutation-checked);
(2) M2 request bodies are STRICT: unknown keys (including forbidden ones like `status` or `releaseNumber`) are
400s, and vocabularies come from `@prowess/model`; unknown query parameters are 400s too; (3) the M1 envelopes,
error shape, pagination and serializer are reused unchanged; M2 lists page over the services' ordered results
rather than rewriting services for HTTP; (4) named POST commands for every lifecycle move; no DELETE/PATCH/PUT
on governance resources; (5) "latest" is numeric only, `null` (200) when none; `resolve` returns `{ resolution:
null }` (200) for an unpinned Entity; hash verification is 200 even when invalid; (6) no migration, no UI, no
auth, no OpenAPI, no URL versioning. The eight earlier "no HTTP route or UI yet" audits now exclude only
`app/api` (whose inventory WO9 pins) and still forbid UI until M2-WO10; a `\b`-after-operator regex trap was
caught by the new audit's own control case before it shipped.

## M2-WO10: Ruleset & Canon Studio UI

Full design in `docs/architecture/ruleset-canon-studio-ui.md`. Decisions worth keeping: (1) the governance UI
is an operator interface over the M2 HTTP API — one typed client layer (`src/api-client`) is the only
`fetch` caller (relative `/api`, GET/POST only) and preserves domain error codes; no `@prowess/db`/Prisma
import (architecture rule + static audit); (2) no business rule lives in React: operation fields and decision
affordances are DERIVED from `@prowess/model`'s rule tables, and no resolution, hashing, translation, impact
or ranking logic runs client-side; (3) one route tree with durable ID URLs for every historical record; Canon
Manager IS the Ruleset workspace; (4) the top-bar selector is a VIEWING control only (URL-derived, navigates,
never writes; labelled "Viewing"); (5) lifecycle commands are named, status-gated buttons behind accessible
confirmation dialogs — no status dropdown; (6) no migration, no client cache library, no component framework;
(7) the entity picker merges M1's name/alias search with its exact canonical-key filter (a gap the E2E run
found). Phase-1 list pagination over ordered service results is recorded as technical debt to replace with
database-level pagination before large imports or public API use.

## M2-WO11: Ruleset migration planning & legacy preservation

Full design in `docs/architecture/ruleset-migration-legacy.md`. Decisions worth keeping: (1) planning is not execution —
preview is read-only, plans are immutable, and no apply/execute/upgrade path exists; (2) both Releases are explicit and
must differ; nothing is inferred from "latest"; (3) both hashes are verified with the WO8 verification service before any
assessment, and plans record the verified hashes; (4) structural classification is Version identity only, ordered by Entity
id; the pure `assessMigration` agrees with WO8's `diffCompositions`; (5) compatibility is never overstated — only UNCHANGED
or REVIEW_REQUIRED, while the full PAS-08 vocabulary is stored for the future; (6) composite keys make an item's Versions
belong to its Entity; everything is RESTRICT; plan + items are one transaction; (7) cross-Ruleset comparison is supported
over flattened compositions; (8) no saved-creation tables, no route, no UI.
