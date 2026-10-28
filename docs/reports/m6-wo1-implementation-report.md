# M6-WO1 Implementation Report — Compendium Administration Foundation

**Status: LOCALLY COMPLETE — awaiting publication authorization** (§90). Branch `m6-wo1`, based on `91658f717bc8c09e7e973175bb5370071d5442b3`.
Architecture: `docs/architecture/m6-compendium-administration.md`. Invariants: `docs/architecture/m6-invariants.md` (M6-I001–I010).

## 1. Test Totals

Local run on the m6-wo1 working tree (PostgreSQL 16, clean test database, Node 22):

| Suite | Baseline (91658f7) | M6-WO1 | Δ |
| --- | --- | --- | --- |
| @prowess/model unit | 27 files / 513 | 27 / 513 | — |
| @prowess/ui unit | 1 / 21 | 1 / 21 | — |
| @prowess/import unit | 5 / 128 | 5 / 128 | — |
| @prowess/rules unit (M4) | 17 / 659 | 17 / 659 | — (no M4 change) |
| @prowess/game unit | 35 / 921 | 36 / 937 | +1 file / +16 (validator parity) |
| @prowess/db unit | 18 / 96 | 19 / 143 | +1 / +47 (catalog projection) |
| @prowess/db integration | 43 / 527 | 44 / 532 | +1 / +5 (service, cross-kind M5 bridge, concurrency) |
| Studio unit / component / static | 80 / 2,854 | 84 / 2,970 | +4 files; +65 new tests, +51 from existing parameterized audits now scanning the new files |
| Studio API integration | 29 / 165 | 30 / 196 | +1 / +31 |
| Playwright (production build) | 45 | 46 | +1 (§85 UX acceptance) |

Every suite passed. Lint, architecture boundaries (12 rules, no cycles), typecheck, gate inventory, control-harness
self-test and the Next.js production build all passed.

## 2. Architecture Gate

`apps/studio/tests/unit/m6-wo1-static.test.ts` — 25 checks, registered as the permanent CI gate **"M6-WO1 audit —
Compendium Administration Foundation"** (job `controls-2`, `scripts/ci/gates.json`; inventory 33 gates / 298 controls).
It verifies: Compendium frontend imports no Prisma / `@prowess/db` / M5 package; routes are thin shape-only adapters with
central error mapping; the route inventory equals the reviewed registry `docs/architecture/m6-api-routes.json`; the
catalog is computed from `PROWESS_DEFINITION_KINDS` and no Studio source holds a kind table or M5 vocabulary values; no
duplicate M5 validator (authoring delegates to `validateStoredProwessDefinition` and only classifies codes); Create and
Save refuse unstorable content before writing; DRAFT-only edits with optimistic `updatedAt`; DRAFT-only, server-allocated
revisions; no client revision number / status; kinds read only from stored data; no latest selection or deletion; the
only M2 call is `createChangeSet` with one exact `PIN_ENTITY_VERSION`; explicit Ruleset context and a paginated viewing
selector; exact references; side-effect-free preview; Keyword vocabulary checks; no Effect fields on Targeting; every M4
source, the schema / migrations and every M5 mechanics file byte-identical to `m6-wo1-baseline.json`; the approved M5
surface change is exactly the reviewed addition; M5-SC-042…053 unresolved and M5-SC-054 resolved; the M6 invariant
catalog, documentation and CI step.

## 3. Controls

`scripts/m6-wo1-negative-controls.mjs` — **18 mutation controls on the shared CLOSEOUT-03 harness, all caught and
restored byte-for-byte** (1 baseline + 18 mutation guard runs; ≈ 1 min 50 s locally): bypass the API (DB import in the
Compendium); M5 validation replaced by a constant PASS; editing an immutable revision; Definition kind inferred from the
display name; display name stored instead of the exact reference; hand-off routed to a lifecycle mutation (publish
bypass); server refusal removed from Save; Entity created before validating; Effect resolution field on Targeting;
hand-written kind table in the UI; catalog copied instead of derived; M5 vocabulary values hard-coded in the UI;
client-supplied revision number; Preview saving the Draft; latest-revision lookup in authoring; M4 source change; schema
change; M5 mechanics change. All 14 pre-existing control scripts (280 controls) were re-run against the M6-WO1 tree:
**all 298 controls across the 15 scripts were caught and restored** (M4-final 3, M5-WO1…WO13 277, M6-WO1 18), with the working tree unchanged after each script.

## 4. Branch, Files, Routes, API

- **Files:** 31 modified, 52 added (see `git show --stat`). New UI: `apps/studio/app/compendium/admin/**`; new server module
  `packages/prowess-db/src/compendium-authoring/`; ten route adapters under `apps/studio/app/api/compendium-authoring/`.
- **UI routes:** `/compendium/admin`, `/compendium/admin/new`, `/compendium/admin/entities/:entityId`,
  `/compendium/admin/entities/:entityId/revisions/:versionId`; `/compendium` unchanged apart from a link to the admin.
- **API:** catalog (GET), validate (POST), definitions (GET list / POST create), entity-versions/:id (PUT save draft),
  …/:id/validation (GET), …/:id/submit-review (POST), …/:id/change-set-proposals (POST), entities/:id/revisions (POST),
  definition-references (GET), keywords (GET). New `COMPENDIUM_AUTHORING.*` DomainError vocabulary, each explicitly
  mapped. Existing M1 / M2 routes are reused for aliases, Keyword assignments, relationships, provenance, status reopen,
  Rulesets and Manifests.

## 5. Definition Kinds Supported

Every kind the M5 catalog marks authorable (at least one payload schema version): the Spell and Maneuver Targeting /
Effect / Trait / Duration / Condition kinds and `MANEUVER_FOUNDATION` with dedicated descriptors; `AFFINITY` v1 with a
dedicated descriptor; `SHARED_TRAIT` (TRAIT contract); and all other active kinds (core, character, skill, runtime,
action, terrain, Affinity v2 and rule kinds, `ABILITY_CONSTRUCTION_RULE`, `SPELL_DEFINITION`, `MANEUVER_DEFINITION`)
through the generic structured editor. Reserved kinds (no payload contract) are listed but refused (§55).

## 6. Authoring Descriptor Architecture

Presentation-only descriptors keyed by the M5 shared-contract name: label, group, input type, the NAME of the catalog
vocabulary for selects, required flag, help, collection behavior and reference positions. Option values come from the
catalog endpoint; opaque M5 data is edited with a typed authored-data editor; raw JSON is read-only unless a developer
edit is explicitly enabled. UI tests run against a catalog fixture generated from the live M5 registry (drift-checked).

## 7. Storage, M5 Bridge, M2 Bridge

- **Storage:** Entity + EntityVersion `structuredData.prowessDefinition`; no schema change or migration (§6, §80).
- **M5 validation bridge:** the §81-approved `validateStoredProwessDefinition` (behavior-preserving extraction from the
  envelope reader; parity-tested with `readStoredProwessDefinition` over every fixture Definition), wrapped by
  `@prowess/db` and reached by Studio only over HTTP.
- **M5 materialization bridge:** the worked example `spell.effect.m6_test_force_push` and every reference-free certified
  fixture component are authored, approved, pinned by a Manifest and materialized through
  `materializeProwessDefinitionsFromManifest` to the authored content.
- **M2 bridge:** a passing revision becomes an ordinary DRAFT ChangeSet (one exact `PIN_ENTITY_VERSION`) in an explicitly
  chosen Ruleset through M2's `createChangeSet`; Manifests, Releases and EntityVersions are untouched.

## 8. Confirmations

- **No M4 change:** `packages/prowess-rules/src` byte-identical to 91658f7 (65 files; gate-checked).
- **No M5 mechanics change:** every `@prowess/game` file except the three of the approved surface addition is
  byte-identical; the full game suite (937) and all M5 gates pass.
- **No schema / migration change.**
- **Prisma drift:** not runnable locally — the sandbox cannot download Prisma's schema engine (`binaries.prisma.sh`
  blocked); migrations were applied with `psql` and Client generation used no engine. With no schema or migration change
  the CI drift check is expected to report no difference; it runs in Tier 2.

## 9. Changes To Existing Permanent Tests (all additive, protection preserved)

- M5 route-freeze gates (WO2–WO13) compare the live route list with their frozen baseline **plus** the reviewed M6 route
  registry (`tests/unit/later-milestone-routes.ts`); unregistered routes still fail every M5 gate.
- `m2-api-static` excludes `/api/compendium-authoring/*` from the M2 surface (same precedent as `/import` and `/rules`).
- Public-surface allowlists (`m2-final-static`, `entity-version-lifecycle`, `change-set`, `m1-audit-static`,
  `ci-gate-inventory`) list the new exports / vocabulary / control script explicitly; the lifecycle test additionally
  proves `updateAuthoredDraftDefinition` delegates its only write to `updateDraftEntityVersion`.
- `51fa2de` was followed by one local commit adding Entity-workspace UI tests (aliases, Entity-level Keywords, relationships,
  history links, Create New Revision, error states, generic content — §65), registered in the M6-WO1 gate.
- `app-shell.test` mocks the paginated `listAllRulesets`; `m2-api-harness` gained a prefix-scoped Ruleset cleanup.

## 10. Ruleset Selector (§35)

Fixed in WO1: the selector now follows every page of `/api/rulesets` (`listAllRulesets`) instead of the first 100. It
remains a viewing control.

## 11. Known Limitations

See the architecture document §9: the save check-then-write window, staged (pre-validated) creation, generic editing of
deep M5 sub-contracts, compatibility-relation suggestions, per-page "needs attention", unpaginated Source Document list,
lifecycle states beyond review left to their existing tools, and no Definition attachment to generic Entities.

## 12. Publication

Not published. Pushing `m6-wo1`, opening a draft PR and running Tier 2 require explicit authorization (§90); merging
requires separate authorization (§91).
