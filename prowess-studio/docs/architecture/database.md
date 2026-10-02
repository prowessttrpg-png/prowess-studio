# Database & Persistence — M0-WO3

**Status: APPROVED (PASS).** The post-cleanup GitHub Actions run completed
successfully: Prisma schema validation, client generation, the canonical
migration (`20260930235722_init`) deploying cleanly to both
`prowess_studio_dev` and `prowess_studio_test`, the real Prisma-backed
integration suite (connection, CRUD, transaction commit/rollback, dev/test
isolation), the guarded `db:reset:test` and its dev-target refusal, lint,
typecheck, and build all passed — 49 tests total, no skipped
Prisma-blocker test remaining. M0-WO3 is complete. The "Final verification
requirements" checklist that used to appear at the bottom of this document
has been satisfied in full and is retained below only as a historical
record of what was proven.

## Prerequisite

- PostgreSQL. Developed and verified against PostgreSQL 16.15 (Ubuntu
  package `postgresql-16`) and against GitHub Actions' `postgres:16`
  service-container image. Any reasonably current PostgreSQL should work.
- Two local databases, matching the names already used by
  `apps/studio/.env.development` / `.env.test` (see M0-WO2):
  - `prowess_studio_dev`
  - `prowess_studio_test`

  Create them once, locally:

  ```sh
  psql -h 127.0.0.1 -U postgres -c "CREATE DATABASE prowess_studio_dev;"
  psql -h 127.0.0.1 -U postgres -c "CREATE DATABASE prowess_studio_test;"
  ```

  (Adjust user/host to match your local Postgres setup and
  `apps/studio/.env.development` / `.env.test`'s `DATABASE_URL` values.)

## Package/database boundary

```
packages/prowess-db/
  prisma/
    schema.prisma             — the Prisma schema
    migrations/
      migration_lock.toml
      20260930235722_init/
        migration.sql          — M0-WO3's canonical migration
      20261001045349_add_entity/
        migration.sql           — M1-WO1's canonical migration (Entity)
      20261001212804_add_entity_version/
        migration.sql            — M1-WO2's canonical migration (EntityVersion)
      20261001215241_add_entity_version_updated_at/
        migration.sql             — M1-WO3's canonical migration (updated_at)
      20261002022400_add_entity_alias/
        migration.sql              — M1-WO4's canonical migration (EntityAlias)
      20261002025218_add_keyword_foundation/
        migration.sql               — M1-WO5's canonical migration (Keyword foundation)
      20261002225710_add_entity_relationship/
        migration.sql                — M1-WO6's canonical migration (EntityRelationship)
  prisma.config.ts              — Prisma 7 CLI config (datasource URL for Migrate)
  src/
    client.ts                   — the centralized PrismaClient singleton (ACTIVE)
    testDatabaseGuard.ts          — safety guard (no Prisma dependency)
    entity/                        — Entity repository + service (M1-WO1)
      repository.ts                  — Prisma queries only (internal, not exported)
      service.ts                      — validates input, maps errors (public surface)
      index.ts                         — re-exports the service only
    entity-version/                 — EntityVersion repository + service
                                        (M1-WO2 create/retrieve; M1-WO3 lifecycle/mutation)
      repository.ts                     — Prisma queries, bounded-retry revision
                                        allocation, and the two atomic conditional
                                        UPDATE primitives (internal, not exported)
      service.ts                         — validates input, parent lineage, lifecycle
                                        transitions, maps errors (public surface)
    entity-alias/                    — EntityAlias repository + service (M1-WO4)
      repository.ts                     — Prisma queries, the alias-to-Entity join
                                        (internal, not exported)
      service.ts                         — validates/normalizes input, maps errors
                                        (public surface)
    keyword-category/                — KeywordCategory repository + service (M1-WO5)
    keyword-definition/               — KeywordDefinition repository + service (M1-WO5)
    entity-keyword/                    — Entity-level Keyword assignment (M1-WO5,
                                        no lifecycle guard)
    entity-version-keyword/             — Version-level Keyword assignment (M1-WO5,
                                        atomic SELECT...FOR UPDATE DRAFT guard)
    entity-relationship/                 — EntityRelationship repository + service
                                        (M1-WO6, stable-identity-level only)
      index.ts                            — re-exports the service only
    index.ts                      — package entry point (exports all of the above)
  generated/                       — prisma generate's output (gitignored, never committed)
  tests/
    unit/testDatabaseGuard.test.ts  — pure guard-logic tests
    integration/                      — real Prisma-based integration tests (ACTIVE)
      persistence.test.ts                — M0-WO3's generic CRUD/transaction/isolation proofs
      entity.test.ts                      — M1-WO1's Entity-specific proofs
      entity-version.test.ts               — M1-WO2's EntityVersion-specific proofs
                                          (incl. the concurrency test)
      entity-version-lifecycle.test.ts      — M1-WO3's lifecycle/mutation proofs
                                          (incl. the race-safety test and the
                                          no-escape-hatch export-surface guard)
      entity-alias.test.ts                   — M1-WO4's alias proofs (incl. the
                                          historical-terminology use case)
      keyword-definition.test.ts              — M1-WO5's Category/Definition proofs
      entity-keyword.test.ts                   — M1-WO5's entity-level assignment
                                          proofs
      entity-version-keyword.test.ts            — M1-WO5's version-level assignment
                                          proofs (lifecycle guard, historical
                                          independence, reverse lookup, no-implicit-
                                          mechanics)
      entity-relationship.test.ts                — M1-WO6's relationship proofs (incl.
                                          no-implicit-mechanics, version independence,
                                          and the FK delete-protection test)
  scripts/
    reset-test-db.mjs                  — the one vetted entrypoint for db:reset:test
```

`@prowess/model` (and future `@prowess/rules`, `@prowess/canon`) must never
import Prisma, Next.js, or any database client. The dependency direction is
strictly:

```
prowess-model  <-  prowess-db  <-  application (apps/studio)
```

`prowess-db` may depend on Prisma; `prowess-model` may not, and nothing in
this Work Order changed that — confirmed by inspection: `@prowess/model`'s
`package.json` lists no Prisma/database dependency, and nothing under
`packages/prowess-model/src/` imports from `@prowess/db`, Prisma, or any
database client.

## Prisma 7 config-file migration (discovered via the Verification Gate)

The first real run of the Verification Gate (in GitHub Actions, a genuine
Prisma-capable environment) surfaced a real Prisma 7 breaking change,
independent of the network blocker below — this was a correctness bug in
`schema.prisma`, not an environment limitation:

**Prisma 7 removed the `datasource { url = ... }` field from
`schema.prisma` entirely.** Connection URLs for Migrate/CLI now live in a
separate `packages/prowess-db/prisma.config.ts` file instead. Attempting
`prisma validate` against a schema with `url = env("DATABASE_URL")` in the
`datasource` block fails with `P1012: The datasource property 'url' is no
longer supported in schema files.` The `previewFeatures = ["driverAdapters"]`
generator flag is also gone/deprecated in v7 — that functionality is now
built in, no flag needed.

Fixed by:
- Removing `url` from `schema.prisma`'s `datasource` block (kept `provider
  = "postgresql"` only) and removing the obsolete `previewFeatures` line.
- Adding `packages/prowess-db/prisma.config.ts`, which sets
  `engine: "classic"` (Prisma 7's traditional native-engine mode for
  Migrate — explicit here to avoid any ambiguity with v7's other two modes,
  a driver adapter or Prisma Accelerate) and reads `DATABASE_URL` via the
  `env()` helper. This file does **not** load any `.env` file itself —
  `DATABASE_URL` is already populated in `process.env` by
  `scripts/with-env.mjs` (which every `db:*` root script already runs
  first).

**Status: RESOLVED and confirmed working** — the first Gate run's schema
validation, generation, and migration steps all passed with this fix.

## Prisma 7 requires a driver adapter for the generated Client (RESOLVED)

Separately from the CLI-side config-file change above, Prisma's own v7
upgrade guide states that the *generated `PrismaClient` itself* now
requires a driver adapter for every database, at runtime, unconditionally
— this applies regardless of the `prisma.config.ts` engine setting (which
only governs how the *CLI* connects for Migrate) and regardless of which
generator provider name or `engineType` is used. There is no v7
configuration that restores the old "no adapter needed" behavior.

Implemented by:
- `schema.prisma`'s generator block: `provider = "prisma-client"` (Prisma's
  current recommended generator name) with an explicit `output =
  "../generated/prisma"` — the `output` field is also now required in v7
  (no longer defaults into `node_modules`). This path is gitignored, like
  `dist/` — generated code is never committed.
- `packages/prowess-db/src/client.ts` (promoted from the former
  `prisma-client-pending/client.ts`): constructs a `PrismaPg` adapter
  (`@prisma/adapter-pg`) from `DATABASE_URL`, then passes it to
  `new PrismaClient({ adapter })`. Imports `PrismaClient` from the
  generated output path (`../generated/prisma/client.js`), not from
  `@prisma/client` directly, per Prisma 7's own convention for custom
  output paths.
- `@prisma/adapter-pg` and `pg` are real (non-dev) `dependencies` of
  `@prowess/db`, not just a sandbox-verification tool. **This is not `pg`
  replacing Prisma** — all schema definition, migrations, and query
  generation remain entirely Prisma's; `pg` is the low-level connection
  driver Prisma's own adapter uses internally, exactly as Prisma's official
  docs instruct (`npm install @prisma/adapter-pg pg` together — `pg` is
  never bundled transitively, it must be an explicit dependency). `@types/pg`
  is kept as a devDependency because `@prisma/adapter-pg`'s public
  TypeScript API surface references `pg`'s types, which `pg` does not ship
  inline — this is needed for complete type-checking even though no file
  under `src/` imports from `pg` directly.

**Status: implemented, not yet verified.** This sandbox cannot run `prisma
generate` to produce `generated/prisma/client.js`, so none of
`src/client.ts`'s imports can be locally type-checked or built here. The
next GitHub Actions run is the first real test of this code.

## Also removed in Prisma 7: `--skip-generate` and `--skip-seed` (RESOLVED)

Both flags were deleted outright (not renamed) from `migrate dev` and
`migrate reset` in Prisma 7 — per Prisma's own v7 CLI reference, neither
command runs generate or seed automatically anymore, so there's nothing
left to skip. Removed from the workflow's migrate step and from
`packages/prowess-db/scripts/reset-test-db.mjs`'s `migrate reset` call. No
behavior change of substance: this project has no seed script configured.
**Status: RESOLVED and confirmed working** in the first Gate run.

## Historical blocker (RESOLVED via GitHub Actions)

`prisma generate`, `prisma validate`, and every `prisma migrate *` command
require a native `schema-engine` binary, downloaded at run time from
`https://binaries.prisma.sh`. **This host remains blocked in this
development sandbox's network egress** (`x-deny-reason: host_not_allowed`,
re-confirmed via direct `curl` as recently as the second Gate iteration).
No workaround was found or attempted (`PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING`
only gets past the checksum-fetch step, not the actual blocked download;
`PRISMA_ENGINES_MIRROR` has no alternate target available).

**This was never an architecture problem — it was resolved by using a
different, genuinely Prisma-capable environment**, exactly as intended: the
`.github/workflows/m0-wo3-prisma-verification.yml` workflow, run manually
via `workflow_dispatch` in GitHub Actions, where `binaries.prisma.sh` is
reachable. That first run passed in full. This sandbox's own inability to
run Prisma CLI operations remains true today and going forward — it is
preserved here as development history explaining why certain changes in
this Work Order could be implemented but not locally verified, not as an
active blocker on the project.

### What was proven in the first GitHub Actions run (schema/CLI level)

| Command / capability | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | ✅ PASS |
| Prisma schema validation (`db:validate`) | ✅ PASS |
| Prisma Client generation (`db:generate`) | ✅ PASS |
| Initial migration created + applied (dev) | ✅ PASS (this is now the committed `20260930235722_init`) |
| Migration status | ✅ PASS |
| Migration deploy (test) | ✅ PASS |
| Guarded `db:reset:test` (real reset) | ✅ PASS |
| Safety guard refuses a dev-targeted reset | ✅ PASS |
| `pnpm lint` | ✅ PASS |
| `pnpm typecheck` | ✅ PASS |
| `pnpm test` | ✅ PASS (included 1 expected skip — the then-still-present blocked placeholder) |
| `pnpm build` | ✅ PASS |

### What changed after the first Gate run, confirmed working by the second

- The migration generated in that first run was independently reviewed
  outside this conversation and approved as canonical; it is now committed
  at `packages/prowess-db/prisma/migrations/20260930235722_init/migration.sql`
  (see "Canonical migration" below).
- `src/client.ts` is now the active, promoted implementation (driver
  adapter, as described above) — previously this was deliberately
  unpromoted/unbuilt code.
- `packages/prowess-db/tests/integration/prisma-blocked.test.ts` (the
  `it.skip` placeholder) is removed, replaced by real Prisma-backed tests
  in `packages/prowess-db/tests/integration/persistence.test.ts`.
- `packages/prowess-db/sandbox-verification/` (the temporary `pg`-based
  verification suite) is removed entirely, along with its vitest config and
  package script.
- The workflow's migration step changed from `migrate dev --name init`
  (generate-and-apply, used when no migration existed yet) to `migrate
  deploy` (apply-only, non-interactive) for **both** databases now that a
  canonical migration is committed — there is nothing left to generate.
- Two build-configuration issues surfaced and were fixed along the way:
  `tsconfig.json`'s `rootDir` had to widen from `src` to `.` so Prisma's
  generated TypeScript source (which lives in the sibling `generated/`
  directory) could be compiled too, which in turn moved the compiled output
  from flat `dist/*.js` to `dist/src/*.js` — `package.json`'s `main`/
  `types`/`exports` and `scripts/reset-test-db.mjs`'s dynamic import were
  both updated to match.

All of the above was confirmed working by the second, post-cleanup GitHub
Actions run — see the Status line at the top of this document.

## Canonical migrations

**`20260930235722_init`** — the first migration in this repository.
Creates exactly one table, `_system_migration_probe` (the internal
migration-verification model from `schema.prisma`, not a Prowess domain
table):

- `id` — `UUID`, primary key, `DEFAULT gen_random_uuid()`
- `label` — `TEXT NOT NULL`
- `created_at` — `TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `updated_at` — `TIMESTAMPTZ(6) NOT NULL` (Prisma-managed via `@updatedAt`,
  not a database-level default/trigger)

No unrelated tables, no destructive statements, no PostgreSQL extensions
(`gen_random_uuid()` is available in PostgreSQL 16 core).
`migration_lock.toml` specifies `provider = "postgresql"`.

**Provenance note:** this file's exact bytes were reconstructed from the
documented shape of the externally-reviewed migration (table/column names,
types, defaults), using standard, deterministic Prisma SQL-generation
conventions for this exact schema — the actual downloaded artifact's raw
bytes were never pasted into this development conversation. **Confirmed
valid**: the post-cleanup GitHub Actions run successfully deployed this
exact file via `prisma migrate deploy` to both `prowess_studio_dev` and
`prowess_studio_test`, with `prisma migrate status` reporting it current —
Prisma accepted it without a drift warning or checksum complaint.

**`20261001045349_add_entity`** (M1-WO1) — adds the first real Prowess
domain table, `entities`, plus the `EntityType` enum. See
`docs/architecture/entity-model.md` for the full Entity domain
documentation. Creates:

- the `EntityType` Postgres enum (`GENERIC_RULE`, `SYSTEM`, `RESOURCE`,
  `SPELL_EFFECT`, `SPELL_TRAIT`, `TARGETING`, `KEYWORD`)
- `entities`: `id` (`UUID`, primary key, `DEFAULT gen_random_uuid()`),
  `entity_type` (`EntityType NOT NULL`), `canonical_key` (`TEXT NOT NULL`,
  `UNIQUE`), `created_at` / `updated_at` (`TIMESTAMPTZ(6)`, same
  conventions as above)

No unrelated tables (no `EntityVersion`, `EntityAlias`, `Keyword`,
`EntityRelationship`, `SourceDocument`, `Ruleset`, or Spell-specific
tables — all explicitly out of scope for M1-WO1), no destructive
statements, no new extensions. Same provenance caveat as
`20260930235722_init` above: reconstructed from the schema using the same
deterministic Prisma SQL-generation conventions, not yet confirmed by a
GitHub Actions run as of this Work Order's completion report.

**`20261001212804_add_entity_version`** (M1-WO2) — adds `entity_versions`,
plus the `EntityVersionStatus` and `ChangeType` enums. See
`docs/architecture/entity-version-model.md` for the full EntityVersion
domain documentation. Creates:

- the `EntityVersionStatus` enum (`DRAFT`, `IN_REVIEW`, `APPROVED`,
  `PLAYTEST`, `CANON`, `DEPRECATED`, `SUPERSEDED`, `ARCHIVED`)
- the `ChangeType` enum (`EDITORIAL`, `CLARIFICATION`, `PRESENTATION`,
  `MECHANICAL_PATCH`, `MECHANICAL_CHANGE`, `BREAKING_CHANGE`,
  `CONTENT_ADDITION`, `REMOVAL`, `RENAME`, `RESTRUCTURE`)
- `entity_versions`: `id` (`UUID`, PK), `entity_id` (`UUID NOT NULL`, FK to
  `entities.id` with `ON DELETE RESTRICT` — an Entity with Versions cannot
  be physically deleted), `revision_number` (`INTEGER NOT NULL`, unique
  together with `entity_id`), `status` (`EntityVersionStatus NOT NULL
  DEFAULT 'DRAFT'`), `display_name` (`TEXT NOT NULL`), `short_description`
  / `rules_text` (nullable `TEXT`), `structured_data` (`JSONB NOT NULL
  DEFAULT '{}'`), `parent_version_id` (nullable `UUID`, self-referencing FK
  with `ON DELETE RESTRICT`), `change_type` (nullable `ChangeType`),
  `change_summary` (nullable `TEXT`), `created_at` (`TIMESTAMPTZ(6)`) — no
  `updated_at` (deliberate — see entity-version-model.md's "Snapshot
  behavior")

No unrelated tables (no `EntityAlias`, `Keyword`, `EntityRelationship`,
`SourceDocument`, `Ruleset`, or Spell-specific tables), no destructive
statements, no new extensions. Same provenance caveat as the two earlier
migrations: reconstructed from the schema using the same deterministic
Prisma SQL-generation conventions already confirmed correct twice before,
not yet independently confirmed by a GitHub Actions run for this specific
file as of this Work Order's completion report.

**`20261001215241_add_entity_version_updated_at`** (M1-WO3) — adds
`entity_versions.updated_at` only. See
`docs/architecture/entity-version-lifecycle.md` for the full lifecycle and
mutation-policy documentation this column supports. A single
`ALTER TABLE ... ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT
CURRENT_TIMESTAMP` — the default exists only to backfill any pre-existing
rows at migration time; every write through `@prowess/db`'s services sets
this explicitly via Prisma's `@updatedAt`. No other schema change, no new
tables, no destructive statements. Same provenance caveat as the three
earlier migrations: reconstructed from the schema using the same
deterministic conventions, not yet independently confirmed by a GitHub
Actions run for this specific file as of this Work Order's completion
report.

**`20261002022400_add_entity_alias`** (M1-WO4) — adds `entity_aliases`
only. See `docs/architecture/entity-alias-model.md` for the full alias
domain documentation. Creates:

- `entity_aliases`: `id` (`UUID`, PK), `entity_id` (`UUID NOT NULL`, FK to
  `entities.id` with `ON DELETE RESTRICT`), `alias` (`TEXT NOT NULL`,
  authored form), `normalized_alias` (`TEXT NOT NULL`, lookup form,
  indexed), `context` (nullable `TEXT`, authored), `normalized_context`
  (`TEXT NOT NULL DEFAULT ''`, the deliberate NOT-NULL sentinel strategy
  that avoids PostgreSQL's NULL-is-distinct-from-NULL uniqueness pitfall —
  see entity-alias-model.md), `created_at` (`TIMESTAMPTZ(6)`)
- A unique index on `(entity_id, normalized_alias, normalized_context)`
  (explicit `map` name chosen by hand — the auto-generated Prisma name for
  this three-column constraint would exceed PostgreSQL's 63-character
  identifier limit)
- A plain index on `normalized_alias` for exact-match lookup

No unrelated tables (no `Keyword`, `EntityRelationship`, `SourceDocument`,
`Ruleset`, or Canon tables), no destructive statements, no search-engine
infrastructure. Same provenance caveat as the three earlier migrations:
reconstructed from the schema using the same deterministic conventions,
not yet independently confirmed by a GitHub Actions run for this specific
file as of this Work Order's completion report.

**`20261002025218_add_keyword_foundation`** (M1-WO5) — adds
`keyword_categories`, `keyword_definitions`, `entity_keywords`, and
`entity_version_keywords`, plus the `KeywordAssignmentSource` enum. See
`docs/architecture/keyword-model.md` for the full Keyword domain
documentation. Creates:

- the `KeywordAssignmentSource` enum (`AUTHORED`, `INHERITED`, `CALCULATED`)
- `keyword_categories`: `id` (UUID PK), `canonical_key` (unique), `name`,
  `description` (nullable), `created_at`
- `keyword_definitions`: `id` (UUID PK), `canonical_key` (unique), `name`,
  `category_id` (nullable FK to `keyword_categories.id`, `ON DELETE
  RESTRICT`), `description` (nullable), `deprecated` (`BOOLEAN DEFAULT
  false`), `created_at`
- `entity_keywords`: **composite primary key** `(entity_id, keyword_id)` —
  no separate `id` column; FKs to `entities.id` and
  `keyword_definitions.id` (both `ON DELETE RESTRICT`), `source_type`,
  `created_at`
- `entity_version_keywords`: same composite-PK shape, FKs to
  `entity_versions.id` and `keyword_definitions.id` (both `ON DELETE
  RESTRICT`), `source_type`, `created_at`
- Indexes: `category_id` on `keyword_definitions`, `keyword_id` on both
  assignment tables (reverse-lookup support)

No unrelated tables (no `EntityRelationship`, `SourceDocument`, `Ruleset`,
Canon, or Spell-specific tables), no destructive statements, no full-text
search infrastructure. Same provenance caveat as the four earlier
migrations: reconstructed from the schema using the same deterministic
conventions, not yet independently confirmed by a GitHub Actions run for
this specific file as of this Work Order's completion report.

**`20261002225710_add_entity_relationship`** (M1-WO6) — adds
`entity_relationships` and the `RelationshipType` enum. See
`docs/architecture/entity-relationship-model.md` for the full Entity
Relationship domain documentation. Creates:

- the `RelationshipType` enum (`REQUIRES`, `MODIFIES`, `USES`,
  `COMPATIBLE_WITH`, `INCOMPATIBLE_WITH`, `PART_OF`, `BELONGS_TO`,
  `SEE_ALSO`) — reused verbatim from the framework-independent vocabulary
  M0-WO1 already established, not a parallel enum
- `entity_relationships`: `id` (UUID PK), `source_entity_id` / `target_entity_id`
  (both `UUID NOT NULL`, FKs to `entities.id` with `ON DELETE RESTRICT`),
  `relationship_type` (`RelationshipType NOT NULL`), `metadata` (`JSONB
  NOT NULL DEFAULT '{}'`), `created_at`
- A unique index on `(source_entity_id, target_entity_id,
  relationship_type)` — prevents an exact duplicate while explicitly
  allowing multiple types between the same pair and the opposite direction
- Plain indexes on `source_entity_id` and `target_entity_id` separately
  (the composite unique index alone doesn't serve a target-only reverse
  lookup efficiently, since `target_entity_id` isn't its leading column)

No unrelated tables (no `SourceDocument`, `Ruleset`, Canon, or
`RequirementDefinition` tables), no destructive statements, no graph-
database infrastructure — PostgreSQL remains the relationship store for
Phase 1. No database `CHECK` constraint for the self-reference rule
(deliberate — see entity-relationship-model.md's "Self-reference policy").
Same provenance caveat as the five earlier migrations: reconstructed from
the schema using the same deterministic conventions, not yet independently
confirmed by a GitHub Actions run for this specific file as of this Work
Order's completion report.

## Migration commands

```sh
pnpm db:generate          # prisma generate
pnpm db:migrate:dev        # prisma migrate dev (development only — for *new* migrations)
pnpm db:migrate:deploy      # prisma migrate deploy (production-safe, no prompts)
pnpm db:migrate:status       # prisma migrate status
pnpm db:reset:test            # the ONLY vetted way to reset the test database
```

All five load the correct `.env.$(NODE_ENV)` file first (via
`scripts/with-env.mjs` / `scripts/load-studio-env.mjs`, mirroring
`apps/studio/src/config/load.ts`'s precedence rules) so `DATABASE_URL` is
always resolved the same way the application itself resolves it.

With a canonical migration now committed, `db:migrate:dev` is reserved for
*future* schema changes (adding a real M1 model, for example) — it is no
longer part of this repository's own setup/CI path, which now only ever
*deploys* the existing migration history.

**Never call `prisma migrate reset` directly.** Always go through `pnpm
db:reset:test` — that script is the only place `TEST_DATABASE_ALLOWED=true`
is ever set, which is what makes the safety guard's explicit-confirmation
check meaningful (see the guard's own doc comment in
`testDatabaseGuard.ts`).

## Migration safety by environment

- **Development**: future migrations are generated/applied deliberately via
  `pnpm db:migrate:dev`. No automatic reset.
- **Test**: may be recreated/reset, but only through the one vetted,
  guarded entrypoint (`pnpm db:reset:test`), never automatically as a side
  effect of another command.
- **Production**: use `pnpm db:migrate:deploy` only (deployment-safe, no
  interactive prompts, never generates new migrations). Development/reset
  commands must never run automatically against production.

## Test-database safety guard

Implemented in `packages/prowess-db/src/testDatabaseGuard.ts`, independent
of Prisma. Two functions:

- `assertSafeToResetTestDatabase({ databaseUrl, explicitlyAllowed })` — the
  strict guard for genuinely destructive operations. Requires **all
  three**: the host is a recognized local host (`localhost`/`127.0.0.1`/
  `::1`), the database name ends with `_test`, and `explicitlyAllowed` is
  `true`. `NODE_ENV` alone is never trusted. `explicitlyAllowed` must be
  computed and passed by the caller immediately before the destructive
  call — never read from a committed `.env` file — which is exactly what
  `packages/prowess-db/scripts/reset-test-db.mjs` (the only script that
  sets it) does.
- `assertRunningAgainstTestDatabase(databaseUrl)` — a lighter check (host +
  name only, no explicit flag) used as a `beforeAll` sanity check at the
  top of the real integration test suite, so a misconfigured
  `DATABASE_URL` fails the suite immediately rather than silently writing
  test data into the wrong database.

Proven — via pure unit tests, a live run of `pnpm db:reset:test` against
the real test database, and a separate live run with `DATABASE_URL`
deliberately overridden to the development database (refused immediately,
exit code 1, before any Prisma command ran) — to actually refuse an unsafe
target, not just to compile. This guard is unchanged by this Work Order's
final cleanup; promoting the Prisma client did not touch it.

## Prisma Client lifecycle (ACTIVE — see src/client.ts)

A single `PrismaClient` instance (constructed with a `@prisma/adapter-pg`
driver adapter — see above), cached on `globalThis` in non-production
environments, so Next.js's dev-server hot reload doesn't construct a new
connection pool on every file save (which would otherwise eventually
exhaust PostgreSQL's `max_connections`). Ordinary singleton behavior in
production and tests, where there's no HMR to guard against. No route,
page, or component constructs its own `PrismaClient` or `PrismaPg` adapter
— the real integration test suite
(`packages/prowess-db/tests/integration/persistence.test.ts`) imports the
same shared `prisma` export used everywhere else, plus one explicit,
separate one-off client solely to query the *development* database for the
isolation check (never the shared singleton, which stays pointed at
whichever database the process actually started against).

## Schema conventions for M1 onward

Established now, to be followed by every future Prowess domain table:

- **UUID primary keys**: native PostgreSQL `uuid`, DB-generated
  (`@default(uuid()) @db.Uuid` in Prisma). Never `canonical_key`, a name, or
  an auto-increment integer as the actual identity — canonical keys and
  names are separate, application-level concerns (see the Entity Schema
  Specification).
- **Timestamps**: `created_at` / `updated_at` as `timestamptz` (timezone-
  aware, UTC on the wire) — never a naive local-time column. `updated_at`
  auto-updates via Prisma's `@updatedAt`.
- **snake_case columns/tables** via `@map`/`@@map`, while Prisma Client
  still exposes camelCase field names in TypeScript.
- **Foreign keys and explicit uniqueness constraints** wherever a
  relationship or a uniqueness rule is part of the domain (canonical keys,
  revision numbers per Entity, etc.) — enforced at the database level, not
  only in application code.
- **Migrations are the source of schema evolution** — no manual,
  undocumented schema drift. (The sandbox-verification suite's hand-written
  `SANDBOX VERIFICATION SQL` was the one exception during the earlier,
  blocked phase of this Work Order — it has since been removed entirely
  now that the real Prisma migration exists.)
- **Relational data by default**; JSON only for genuinely variable
  structured configuration (unchanged policy from PAS-01–09) — no arbitrary
  JSON modeling of Prowess domain concepts.
- **Custom SQL migrations are allowed** where a PostgreSQL feature or
  constraint can't be expressed through Prisma's schema language — but only
  as a real, generated-and-then-edited Prisma migration, never as a
  standalone, untracked script. No PostgreSQL extensions are used
  (`gen_random_uuid()` is available in PostgreSQL 16 core, no extension
  required).

## Final verification requirements (satisfied — historical record)

The second GitHub Actions run of the (now-retired)
`.github/workflows/m0-wo3-prisma-verification.yml` proved all of the
following, confirming M0-WO3 as `PASS`:

- [x] Prisma schema validation
- [x] Prisma Client generation
- [x] Canonical migration (`20260930235722_init`) deploys cleanly to a
      fresh `prowess_studio_dev`
- [x] Migration status reports current
- [x] Canonical migration deploys cleanly to a fresh `prowess_studio_test`
- [x] Guarded `db:reset:test` succeeds against the real test database
- [x] The same reset is refused when `DATABASE_URL` is overridden to the
      development database
- [x] Real Prisma CRUD integration tests pass (create, read, update,
      delete, against `prowess_studio_test` only)
- [x] Prisma transaction commit test passes
- [x] Prisma transaction rollback test passes (deliberate throw inside the
      transaction; no partial data persists)
- [x] Dev/test isolation test passes (data written via the test client
      does not appear in `prowess_studio_dev`)
- [x] No skipped Prisma-blocker test remains anywhere in the suite
- [x] `pnpm lint` passes
- [x] `pnpm typecheck` passes
- [x] `pnpm test` passes
- [x] `pnpm build` passes

49 tests passed in that final run. M0-WO3 is **approved**. Every one of
these checks is now a permanent, standing part of
`.github/workflows/ci.yml` (M0-WO4) going forward — see
`docs/architecture/ci.md` — rather than living only in a milestone-specific
workflow.
