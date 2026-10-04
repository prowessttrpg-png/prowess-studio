# M1 Completion Audit (PAS-10 M1-WO11)

**Status: READY FOR FINAL CI GATE.** This is *not* a PASS. It becomes
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

Plus a CI drift check (informational, see finding F-1) and three named CI
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
- **Schema drift (§28):** a Prisma-native check was added
  (`migrate diff --from-config-datasource --to-schema … --exit-code`), but
  deliberately **non-blocking** — see F-1. Deploy-on-empty alone is *not*
  sufficient confidence here, because static review already shows a
  mismatch class it cannot detect.

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

### F-1 — OPEN, needs a human decision: id defaults differ between migrations and `schema.prisma`

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
informational drift step's actual output (F-1); lint; typecheck; unit,
database, API, and the three named audit-gate steps; production build; and
the full Playwright suite including the M1 audit flow and the mobile
regression.
