# M1 Completion Audit (PAS-10 M1-WO11)

**Status: NOT YET PASSED — the first real CI run found defects (sections 11–12).** This is *not* a PASS. It becomes
"M1 APPROVED" only after the permanent GitHub Actions workflow succeeds
against the audit (see "CI result" at the end).

## 1. Scope and method

An integration, reproducibility, integrity, architecture, and documentation
audit of the whole M1 chain (Entity → Versions → lifecycle → aliases →
Keywords → relationships → provenance → API → Compendium → Version History).
No product feature, schema change, migration, Ruleset, or real Prowess
content was added. Every fixture is synthetic (`test.audit.*`).

The audit has four layers, each asserting named invariants:

| Layer | File | Needs |
| --- | --- | --- |
| Static | `apps/studio/tests/unit/m1-audit-static.test.ts` | nothing (runs in unit step) |
| Database | `packages/prowess-db/tests/integration/m1-audit.test.ts` | PostgreSQL |
| API | `apps/studio/tests/integration/m1-audit-api.test.ts` | PostgreSQL |
| Browser | `apps/studio/tests/e2e/m1-audit.spec.ts` | built app + PostgreSQL |

Plus a CI drift check (a blocking gate since F-1 was resolved) and three named CI
steps that re-run the first three layers as a separately-visible gate.

## 2. What was and was not verified locally

**Verified by execution in the authoring sandbox:** the static suite (41
tests, including a deliberate-regression check proving the error-code rule
fails when violated), lint, the architecture checker, all 459 unit tests,
CI-workflow YAML validity, and type-checking of the new integration tests
against the real `@prowess/db` source (zero errors in them).

**Not executed anywhere yet:** the database, API, and browser audit suites.
The sandbox cannot run Prisma or a browser. They were written carefully and
type-checked, but their *passing* is exactly what the final CI run must
establish. No result in this document for those layers should be read as
observed.

## 3. Migration chain and clean bootstrap (§26–28)

- Exactly eight migrations, timestamp-ordered, `provider = "postgresql"`;
  asserted by the static suite.
- No migration contains `DROP`, `TRUNCATE`, `DELETE FROM`, a cascading or
  nulling delete action, or sandbox/TODO residue — asserted per migration.
- Every foreign key in every migration is `ON DELETE RESTRICT`, and every
  relation in `schema.prisma` declares `onDelete: Restrict` — asserted on
  both sides.
- **Clean bootstrap** is the existing CI sequence on an empty database:
  `prisma validate` → `prisma generate` → `prisma migrate deploy` → tests.
  The database audit additionally reads `_prisma_migrations` and asserts the
  approved chain applied in order with none failed or rolled back, that all
  ten M1 tables exist, and that no column anywhere encodes a current/active
  version.
- **Schema drift (§28):** `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` runs against the database built by `migrate deploy` and is a **blocking** CI gate. Its first real run reported drift (F-1, F-13); that was resolved by aligning `schema.prisma` to the approved migrations, and the gate now requires exit code 0 with no differences.

## 4. Invariant → proof map

| Work Order § | Invariant | Proven by |
| --- | --- | --- |
| 3 | Stable identity across revisions; no duplicated aliases/Keywords/relationships | API audit "§3" (before/after deep-equal) |
| 4 | Revision 1 reproduces exactly; no Rev 2 content leaks in | API audit "§4" (deep-equal incl. `updatedAt`, plus negative string checks) |
| 5 | CANON rejects edits and Keyword changes; provenance still manageable | API "§5" ×2, DB "protected Versions" |
| 6 | Editing the DRAFT leaves Revision 1 byte-identical | API "§6" (runs last) |
| 7 | Lineage explicit, not inferred | API "§7", DB "lineage" (+ cross-Entity parent rejected) |
| 8 | Revision numbers unique/allocated; independent per Entity; concurrency | DB "revision allocation" (+ existing `entity-version.test.ts` owns the heavy concurrency proof) |
| 9 | Alias normalization resolves Entity, never a Version | API "§9" (4 spacing/case variants) |
| 10 | Entity / Rev 1 / Rev 2 Keyword layers distinct; no inheritance; no side effects | API "§10" |
| 11 | Relationship is stable-identity scoped; no inverse; non-mechanical | API "§11" |
| 12 | Sources Version-scoped; authority has no effect | API "§12" |
| 13 | Referential integrity | DB "referential integrity" (11 cases, §5 below) |
| 14 | No current-version state anywhere | Static "no global current-version state" + DB column scan |
| 15 | Terminology | Static scan (`compendium-terminology.test.ts`), E2E negative assertions |
| 16 | Enum parity | Static "enum parity" (7 enums, bidirectional) |
| 17 | Error vocabulary | Static "error vocabulary" + existing exhaustive-map typecheck |
| 18–20 | API contract, search, filters | API "§18/§20", E2E "integrated API over real HTTP" |
| 19 | Pagination stability | API "§19" (both query paths agree), E2E pagination test |
| 21–23 | Browser reproducibility, direct URL, comparison | E2E central flow, fresh-context test, comparison test |
| 24 | Persistence | E2E fresh contexts + fresh API client deep-equal |
| 25 | No hidden writes | E2E (GET-only request log + before/after snapshot), API "§25" |
| 29 | Architecture boundaries | `check-architecture.mjs` (7 rules) + static dependency-graph test |

## 5. Referential-integrity audit (§13)

Each case attempts a direct delete and asserts rejection **and** that the
row (and its dependents) survive. No cascade exists anywhere.

1. Entity with EntityVersions
2. Entity with Aliases
3. Entity with Entity-level Keyword assignments
4. Entity as relationship **source**
5. Entity as relationship **target**
6. KeywordDefinition assigned to an Entity
7. KeywordDefinition assigned to an EntityVersion
8. KeywordCategory with KeywordDefinitions
9. SourceDocument with SourceReferences
10. EntityVersion with SourceReferences
11. EntityVersion with Version Keywords
12. EntityVersion that is a lineage parent

## 6. Test inventory

| Area | Coverage |
| --- | --- |
| Entity / EntityVersion / lifecycle | `entity`, `entity-version`, `entity-version-lifecycle`, `persistence` integration; model unit tests |
| Aliases / Keywords / Relationships / Sources | `entity-alias`, `keyword-definition`, `entity-keyword`, `entity-version-keyword`, `entity-relationship`, `source-provenance` integration |
| API | 7 route-handler integration files + shared-helper unit tests + `error-mapping-api` |
| Compendium / Version History | component, API-client, selection-logic, page-level (mocked fetch) unit tests |
| Architecture | `check-architecture.mjs` (7 rules) + static layering/migration/enum/error/no-current-state audit |
| E2E | 4 files (shell, Compendium, Version History incl. mobile, M1 audit) |

Counts (declarations; `it.each` counted once): unit **459** (model 170, ui 21,
db 9, studio 259); database integration **126** declarations over 11 files;
API integration **51** over 8 files; Playwright **27** over 4 files. The
focus is invariant coverage, not raw count.

**Intentionally untested / out of scope:** a literal server-process or
PostgreSQL restart (fresh browser contexts and a fresh API client are used
instead — data still comes from PostgreSQL, not session state); real screen-
reader behavior; load/scale behavior of the status-filter query; anything in
the deferred list below.

## 7. Findings

### F-1 — CONFIRMED by Prisma's drift check; RESOLVED (final CI verification pending): id defaults differ between migrations and `schema.prisma`

*Not fixed, per Work Order §37 (no schema change without stopping to report).*

- **Observed (static):** all nine tables' migrations declare
  `"id" UUID NOT NULL DEFAULT gen_random_uuid()`; `schema.prisma` declares
  `@id @default(uuid())` on all nine, which is a **client-side** default
  with no database default.
- **Predicted, not observed:** Prisma's diff will report this as drift
  (dropping nine defaults). I could not run Prisma to confirm. The CI drift
  step exists to produce the real evidence.
- **Impact:** none at runtime — the client always supplies ids, so the
  database default never fires. The risk is future noise: the next
  `prisma migrate dev` would generate a "drop default" migration.
- **Options:**
  - **A. Make the schema describe reality** — `@default(dbgenerated("gen_random_uuid()"))`.
    Schema-only, no new migration, no data impact; the database would then
    generate ids (PostgreSQL 13+, we run 16). *My recommendation, once CI's
    drift step confirms the prediction.*
  - **B.** Add a migration dropping the nine defaults. Honest but adds a
    migration to a milestone that was meant to add none.
  - **C.** Accept and document; keep the drift step informational.
- **Why this matters for the gate:** CI proving the migrations *deploy* does
  not prove they match what Prisma would generate; the earlier "reconstructed
  from the schema" caveat in `database.md` was therefore only half-resolved,
  and has been reworded to say exactly that.

### F-1 resolution

**CONFIRMED by GitHub's Prisma drift check** (first real run). Prisma reported that on
`_system_migration_probe`, `entities`, `entity_aliases`, `entity_relationships`,
`entity_versions`, `keyword_categories`, `keyword_definitions`, `source_documents` and
`source_references`, the id's database default `Some(DbGenerated("gen_random_uuid()"))`
would change to `None`. The prediction made above ("probable real mismatch") was correct.

**Resolution (option A — recommended, then approved).** `schema.prisma` was aligned to
the already-approved migrations: all nine `@default(uuid())` became
`@default(dbgenerated("gen_random_uuid()"))`, keeping `@db.Uuid` and all mapping and
relations. **No new migration. No data migration. No approved migration SQL altered. No
database default dropped. No migration history rewritten.** The two composite-key
assignment tables have no id column and are unchanged.

**Behavioral consequence, reviewed.** PostgreSQL now generates these ids; Prisma Client
omits `id` from the INSERT and reads the row back, so `create()` still returns the
generated UUID. A code review found nothing that depends on client-side generation: no
`create()` passes an explicit id, nothing calls `randomUUID`, and the only raw SQL is a
`SELECT … FOR UPDATE` (revision/lifecycle locking), not an INSERT. The integration suites
that assert returned UUIDs and revision allocation (entity, version, alias, relationship,
keyword, source, and the M1 audits) re-run in CI against the aligned schema — that run, not
this review, is the proof.

### F-2 — FIXED: `assertEntityExists` accepted an uncontrolled error code

- **Defect:** in `entity-relationship/service.ts`, a private helper took
  `errorCode: string`. Both call sites passed controlled constants, so it
  never misbehaved — but nothing stopped an arbitrary string reaching
  `DomainError`, which the API would then (correctly) turn into a 500.
- **Root cause:** the parameter was typed too loosely.
- **Fix:** typed it `RelationshipErrorCode` (the model's controlled union).
  No behavior change; two lines.
- **Proof:** the static audit now requires every `DomainError` in
  `@prowess/db` to use a controlled constant or a parameter typed with a
  controlled union. I confirmed the rule **fails** when the loose type is
  reintroduced and **passes** with the fix.

### F-3 — Note: canonical keys cannot contain hyphens

The Work Order suggested `test.audit.historical-rule.<unique>`. Canonical-key
syntax is `^[a-z0-9_]+(\.[a-z0-9_]+)+$`, so that would be rejected as
`ENTITY.INVALID_CANONICAL_KEY`. The audit uses `historical_rule`. Not a
defect — the Work Order said "such as".

### F-4 — Housekeeping: loose Playwright assertion tightened (M1-WO10)

`getByRole("heading", { name: "Latest Revision" })` is a substring match and
also matches "Latest Revision Keywords". It was tightened to `exact: true`.
It had passed CI, so I can't say it was broken — it was fragile.

### Documentation corrections (§31)

Ten component documents carried "not yet verified by GitHub Actions" status
lines; they now state the verified status and why the old wording existed.
Seven per-migration "not yet confirmed" phrases in `database.md` were
reworded (see F-1 for the nuance), and four sandbox-limitation sections were
kept and marked as historical/resolved rather than deleted.

## 8. Known limitations

See "Documented scope limitations" in `architecture/m1-entity-version-core.md`
(Entity-level-only keyword filter, latest-revision status filter, any-revision
search, application-side status pagination, textual-only comparison, no
lifecycle event log, no authentication).

## 9. Deferred to M2 and later

Rulesets and current-Version selection · Canon Decisions · SourceAuthority
governance · import/extraction/conflict resolution · field-level provenance ·
Rules Engine · Spell schema · Character content · authentication/permissions ·
authoring UI.

## 10. CI result

**Pending.** To be recorded here after the final workflow run. Expected to
demonstrate: clean PostgreSQL bootstrap; validate/generate/deploy; the
blocking drift step's result (F-1/F-13: must show no differences); lint; typecheck; unit,
database, API, and the three named audit-gate steps; production build; and
the full Playwright suite including the M1 audit flow and the mobile
regression.

## 11. First real CI run — what it found

**Context.** Up to this point none of the M0-WO5 → M1-WO11 work had ever run in
GitHub Actions: the repository's `main` held only the M0-WO1 tree, and the later
work sat in a nested `prowess-studio/` folder that the workflow never saw
(see the synchronization record). Earlier statements in this repository's history
that CI had passed for those Work Orders cannot be reconciled with that and should
be disregarded; this section is the first genuine CI evidence.

**What passed on the first run:** install, `prisma validate`, `prisma generate`,
`migrate deploy` on both databases (the eight-migration chain applied to empty
databases), then — after fix F-5 — build, lint, architecture, typecheck and unit
tests (the database-integration step is where the run next stopped).

### F-5 — FIXED: build error in `selectEntitiesByIds` (M1-WO8)
A loose `(row: { id: string })` annotation, added to quiet a sandbox-only type
cascade, narrowed a `Map` so `toDomainEntity` rejected it under real Prisma types.
It also called the converter before skipping a missing row. Fixed (patch 1).

### F-6 — FIXED, production bug: duplicates escaped as raw Prisma errors
Six detectors (Entity, KeywordCategory, KeywordDefinition, EntityAlias,
EntityRelationship, EntityVersion revision) recognized a unique violation via
`error.meta.target`. With Prisma 7's driver adapter that field is absent; the error
names the *constraint* instead. So duplicate canonical keys / aliases / relationships
/ keywords would have returned HTTP 500 instead of 409, and revision allocation
never retried under concurrency (7 of the 11 failures). Fixed with one shared,
duck-typed detector (`src/prisma-errors.ts`) matching by constraint name, with
17 unit tests whose error shape is copied from the CI log and whose constraint names
are pinned to the actual migrations.

### F-7 — FIXED, test defect: integration files destroyed each other's data
Seven files shared the fixture prefix `test.` with prefix-wide cleanup and ran in
parallel against one database. Integration configs now set `fileParallelism: false`.
This is the diagnosed cause of the cleanup FK failures and the "Entity not found"
failure. **It is the probable (not proven) cause of the lifecycle test's "status
changed concurrently" failure** — if that test still fails once files run
sequentially, it is a real bug and must be investigated as one.

### F-8 — FIXED, stale guard: public-export allowlist frozen at M1-WO3
The test asserted exactly 13 exports; 34 were legitimately added later. The list is
now the reviewed 47, and the test additionally asserts directly that the only
update/set/delete-style operation exported is `updateDraftEntityVersion`.

### Lessons recorded
The authoring sandbox could not run Prisma, so two classes of defect were invisible
to it: type errors that only exist under real generated types (F-5), and runtime
behavior that differs between Prisma's engine and the driver adapter (F-6). Earlier
"verified locally" claims were limited accordingly, and CI is the only authority.

### Second CI round (API integration step)
**Evidence:** 50 of 51 API integration tests passed on the first real run —
including all 15 tests of the canonical reproducibility scenario
(`m1-audit-api`), the error-mapping suite, and the Version lifecycle API suite.
Both remaining problems were defects in test code, not in the product.

### F-9 — FIXED, test defect: incomplete cleanup poisoned later files
`keyword-api` is the only API file that creates Version-level Keyword rows, and
none of the seven per-file `afterAll` blocks deleted them. Its own teardown hit a
foreign-key error and left residue; every later file's prefix-wide cleanup then
failed too (the files that ran *before* it all passed — which is how the cause
was pinned). Replaced all seven blocks with one complete, FK-ordered helper
(`tests/integration/cleanup.ts`). Not a product bug — the schema's `RESTRICT`
foreign keys did exactly their job.

### F-10 — FIXED, test defect: wrong assumption about search, plus a vacuous test
The pagination test searched for a canonical key, but `search` matches aliases and
revision display names only (canonical key is a separate exact filter — by design,
documented in `api-layer.md`). The `entityType` test passed only because `every()`
over an empty list is trivially true. Both now assert real, non-empty results.
**Audit consequence:** one previously "passing" API test proved nothing. Other
tests using `every`/`some` over API results should be reviewed for the same
vacuity.

### F-11 — FIXED, production-build bug: `.js` import specifiers in `apps/studio/src/api`
`next build` failed: Turbopack cannot resolve `./errors.js` (and five siblings) to
the `errors.ts` beside it. Typecheck, lint, and unit tests all accept `.js`
specifiers, so only the production build could notice. Fixed by making the nine
relative imports extensionless; `tests/unit/bundler-import-style.test.ts` now fails
if any bundled app code reintroduces one.
**Honest note on how this was missed:** the authoring sandbox's own `next build`
printed these exact errors (`./errors.js`, `./pagination.js`, …) during M1-WO8.
They were misattributed, together with the genuinely sandbox-only Prisma errors,
to "the missing generated client". Two different problems were collapsed into one
explanation. Lesson: classify build errors individually; never explain a whole
error list with one cause.

### F-12 — FIXED, production-build bug: `useSearchParams()` without a Suspense boundary
With imports fixed (F-11), `next build` compiled and type-checked, then failed while
pre-rendering `/compendium`: a component that reads search params during static
generation must be inside `<Suspense>`. The list page called `useSearchParams()`
directly. Fixed by moving the URL-dependent browser into `CompendiumBrowser`,
wrapped in Suspense by the page (heading kept outside, so it stays in static HTML);
the detail page got the same wrapper as a guard. Only the production build
performs static generation, so lint/typecheck/unit/integration tests could not
see it. `tests/unit/suspense-search-params.test.ts` now encodes the rule.
**Pattern worth naming:** F-11 and F-12 are both "passes every check except the
production build" — the build is the only step that exercises Next's bundler and
static generation, so it must be run (CI is the only place it can be, here).

### F-13 — CONFIRMED & RESOLVED: `entity_versions.updated_at` default (additional drift, same check)
The M1-WO3 migration adds the column `TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP`
(a NOT NULL column added to a table that might already hold rows needs a default);
`schema.prisma` had `@updatedAt` with no default, so Prisma reported the default changing
from `Now` to none. **Resolved** with `@default(now()) @updatedAt`, which preserves
TIMESTAMPTZ(6), the database default on insert, and Prisma's update-time behavior. The
other two `@updatedAt` columns (`entities`, `_system_migration_probe`) have **no** default in
their migrations and correctly stay as they are — changing them would have *introduced*
drift. The static audit now checks, for every `@updatedAt` field, that the schema has a
default exactly when the migration does (proven to fail if `Entity.updatedAt` is wrongly given one).

### F-14 — FIXED, CI script defect: real drift reported as "the command itself failed"
The drift step's summary said "exit 1 — likely a flag/config issue" while the log showed
Prisma exiting **2** (drift). pnpm's recursive runner reports every failed child as exit 1,
so the script could not tell the cases apart. Prisma is now invoked directly so its exact
exit code reaches the script. The step is blocking, prints the diff unfiltered, and repeats
it in the job summary; `m1-audit-static` asserts it stays blocking.

## 12. Final M1-WO11 drift-resolution patch

Scope: schema alignment only — no new migration, no data change, no new features, no M2.
The final CI run must show: Prisma validate PASS; Prisma generate PASS; all eight migrations
deploy from an empty database; **the drift check PASS with no differences, as a blocking
gate**; the three M1 audit gates PASS; all unit and integration tests PASS; the production
build PASS; and every Playwright flow (Compendium, Version History, M1 reproducibility,
mobile) PASS.

**M1 is NOT marked approved by this patch.** Approval depends on that CI run.
