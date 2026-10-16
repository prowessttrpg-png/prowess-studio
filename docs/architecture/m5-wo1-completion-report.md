# WORK ORDER READY FOR CI VERIFICATION — M5-WO1

**Status: not FINAL PASS.** That requires permanent GitHub CI to be green on the `m5-wo1` PR.

## 1. Base Commit / Branch
The base is `c74931a81e801a2c99ff98d4fa2552ab8aefc95d`, the known M4 completion merge. `main` had not advanced. The
work is on branch `m5-wo1`, one commit.

## 2. Source Authority
Precedence (§6): designer clarifications in M5-WO1, then approved CanonDecisions, then Core Playtest V0.1, then older
sources. The full statement is in `m5-prowess-domain-compilation.md` §2.

## 3. Core Playtest Source Identity
The designer's local copy is 98,897,516 bytes, SHA-256 prefix `21fa6771…`. It is byte-identical to the M3-WO9
source; the full identity is kept only in the M3 report (M3-I19). It was parsed with `prowess-docx-structure@1.0.0`:
structure hash `3d9a429c…`, 2,487 sections, 772 tables. The DOCX was not committed.

## 4. Designer Clarifications Applied
All six (A–F) are applied. The table is in the architecture doc §3.

## 5. Evocation / Emission Resolution
M5-SC-001 is `RESOLVED_BY_DESIGNER`. The canonical token is `EVOCATION`. "Emission" is LEGACY and preserved in
sources and provenance. Using it as a canonical value fails with `LEGACY_TERM_AS_CANONICAL`.

## 6. Remaining Source Conflicts
28 of the 31 entries are UNRESOLVED. M5-SC-001, 004 and 012 are resolved by the designer. Rulings are needed before
M5-WO2 on M5-SC-002, 003, 005, 008, 009 and 010.

## 7. Files Created
- `packages/prowess-game/**`: package, tsconfig, vitest config, 15 source files, 5 test suites and fixtures.
- `packages/prowess-db/src/prowess-definition/{index,repository,service}.ts`.
- `packages/prowess-db/tests/integration/prowess-definition-materialization.test.ts`.
- `packages/prowess-db/tests/unit/m5-source-terminology.test.ts`.
- `apps/studio/tests/unit/m5-wo1-static.test.ts`, `m5-wo1-audit-helpers.ts`.
- `scripts/m5-wo1-negative-controls.mjs`.
- `docs/architecture/`: `m5-prowess-domain-compilation.md`, `m5-core-playtest-system-map.md`,
  `m5-core-playtest-source-conflicts.md`, `m5-invariants.md`, `m5-invariants.json`, `m5-wo1-baseline.json`, and this
  report.

## 8. Files Modified
- `packages/prowess-db/{package.json,src/index.ts}`: dependency on `@prowess/game` and the materializer exports.
- `packages/prowess-model/src/errors.ts`: new `PROWESS_MATERIALIZATION_ERROR_CODES`.
- `apps/studio/src/api/errors.ts`: exhaustive HTTP mapping (409) for the new codes.
- `scripts/check-architecture.mjs`: `@prowess/game` boundary rule and cycle graph.
- `.github/workflows/ci.yml`: builds and unit-tests `@prowess/game`; new named M5-WO1 gate.
- `pnpm-lock.yaml`.
- `docs/architecture/ci.md`.
- Deliberate updates to pinned test lists:
  - `apps/studio/tests/unit/m1-audit-static.test.ts`: dependency allowlist and the 29th vocabulary.
  - `packages/prowess-db/tests/integration/entity-version-lifecycle.test.ts` and `ruleset-manifest.test.ts`: export
    surface.

## 9. Files Removed
None.

## 10. Database / Migration Status
No schema change and no migration. Definitions are stored in the existing `EntityVersion.structuredData` under
`prowessDefinition`. There is no DATA MODEL BLOCKER.

## 11. Core Playtest System Map
`m5-core-playtest-system-map.md` covers 15 families with locators, Definitions, Compositions, runtime, inputs and
outputs, FUTURE MAPPING, conflicts and the owning WO.

## 12. Core Resolution Map
System map §1.

## 13. Character Core Map
System map §2.

## 14. Skill Map
System map §3. The Skill + chosen-Stat principle is preserved.

## 15. Resource / Action Economy Map
System map §5 and §6.

## 16. Affinity Map
System map §7.

## 17. Shared Ability Construction Architecture
Architecture doc §6: the `AbilityCompositionBase` grammar in `@prowess/game`.

## 18. AbilityKind Contract
`ABILITY_KINDS = [SPELL, MANEUVER]`. It is explicit and never inferred; a missing kind fails with
`ABILITY_KIND_REQUIRED`. Branch data must match the kind.

## 19. Shared Targeting Contract
`TARGETING` v1 has `semanticShape` (a classifier) and `geometry`. It cannot carry effect, save or resolution keys.

## 20. Spell Targeting Boundary
`SPELL_TARGETING`, stored as EntityType `TARGETING`. It is the only legal Spell targeting kind.

## 21. Maneuver Targeting Boundary
`MANEUVER_TARGETING`. There is no V0.1 content (M5-SC-015, M5-SC-017).

## 22. AoE Semantic Reuse
One geometry contract. `shareTargetingSemanticShape` compares geometry only; exact identity stays separate.

## 23. Shared Effect Contract
`EFFECT` v1: `effectFamily`, `resolution`, `outcomes`.

## 24. Spell Effect Boundary
`SPELL_EFFECT`. It is never legal in a Maneuver (`CROSS_BRANCH_DEFINITION`).

## 25. Maneuver Effect Boundary
`MANEUVER_EFFECT`.

## 26. Shared Trait Contract
`TRAIT` v1 with an explicit `scope`. Trait uses state `appliesTo`.

## 27. Spell Trait Boundary
`SPELL_TRAIT`.

## 28. Maneuver Trait Boundary
`MANEUVER_TRAIT`. The architecture exists; there is no V0.1 content (M5-SC-017).

## 29. Duration Contract
`DURATION` v1 with `durationConcept`, including the Maneuver-only UNTIL_NEXT_TURN. No costs.

## 30. Ability Condition Contract
`ABILITY_CONDITION` v1 (`restriction`, `tradeoff`). It may not apply a status.

## 31. Spell Casting Condition Boundary
`SPELL_CASTING_CONDITION`.

## 32. Maneuver Condition Boundary
`MANEUVER_CONDITION`.

## 33. Resolution Contract
`RESOLUTION_MODES`: ATTACK_ROLL, SAVING_THROW, AUTOMATIC. Resolution belongs to the Effect and is never derived
from Targeting.

## 34. Spell / Maneuver Cost Boundary
Cost contributions are structural, name a currency (MP / AP / HP; never ME), and contain no formula. There is no
shared cost formula.

## 35. Definition / Composition Boundary
Compositions reference Definitions through exact refs and never mutate them (tested).

## 36. Composition / Runtime Boundary
Compositions hold no runtime state and are frozen after validation (tested).

## 37. Presentation Boundary
WO1 adds no UI. No Studio code imports `@prowess/game` (audited).

## 38. @prowess/game Package
`packages/prowess-game`. It is pure, deterministic, plain-data and immutable.

## 39. Package Dependency Audit
Dependencies are `@prowess/model` and `@prowess/rules` only. This is enforced by the architecture script, the M1
allowlist and the M5 static audit. `@prowess/rules` remains model-only.

## 40. ProwessDefinitionEnvelope
Architecture doc §14. Validated by `createProwessDefinitionEnvelope`.

## 41. ProwessDefinitionRef
Five identity fields. Exact match only.

## 42. Schema Versioning
Explicit per kind. Reserved kinds refuse a payload.

## 43. System Family / DefinitionKind Strategy
15 families and 29 kinds (11 with v1 contracts, 18 reserved), plus the `ABILITY_SLOT_KINDS` table.

## 44. ProwessDefinitionBundle
`{ rulesetProvenance, definitions[] }`, ordered by Entity id.

## 45. Bundle Validation
Rejects duplicates, canonical conflicts, EntityType mismatches, unpinned or injected versions, mixed Rulesets, unknown
families or kinds, unsupported schema versions, malformed provenance and unsafe data.

## 46. Exact Definition Materialization
`materializeProwessDefinitionBundle` / `…FromManifest` / `…FromRelease` in `@prowess/db`. Read-only, one query, exact
ids.

## 47. Historical Materialization
The §130 golden passes against the real database: R1 still materializes v1 after v2 content and R2 exist.

## 48. Ruleset Isolation
Tested against the real resolver and in pure bundles.

## 49. Compilation Contract Version
`PROWESS_COMPILATION_CONTRACT_VERSION = 1`.

## 50. ProwessCompilationRequest
`{ contractVersion, subject, definitions, ruleset, actor?, build?, runtime? }`. The bundle is re-validated against
the ruleset.

## 51. ProwessCompiledPlan
`{ contractVersion, subject, rulesetProvenance, evaluationPlan (M4), sourceMap }`.

## 52. Compilation Source Map
One entry per step: components and exact Definitions.

## 53. Deterministic Identity / Ordering
`prowess:<kind>:<composition>:<fragment>`, ordered by explicit `order` then stepKey.

## 54. Hidden-Math Audit
The AST audit rejects all arithmetic and `Math.*` in `@prowess/game` production code. Controls §225–226 confirm it.
A test shows M4 calculating 7 + 2 while the plan holds no result.

## 55. Summoning Map
System map §13: types, building blocks, action models, and the no-implicit-capabilities rule.

## 56. Mage Art Map
System map §11. Mage Arts are fixed, not modular.

## 57. Equipment Dependency Map
System map §12.

## 58. Status / Condition Map
System map §14. Status Conditions are separate from Ability Conditions.

## 59. Source Terminology Inventory
`TERMINOLOGY_INVENTORY`, 142 entries across 17 categories. Statuses are CANONICAL, LEGACY, UNRESOLVED or
SYSTEM_SPECIFIC.

## 60. New M5 Invariants
M5-I001–I040: `m5-invariants.md` and `.json`.

## 61. Tests Added
- `@prowess/game`: 71 tests in 5 suites.
- Materialization integration: 10.
- Source terminology: 2.
- M5 static audit: 134, including 30 in-memory controls.
- 17 behavioural negative controls.

## 62. Static Architecture Audit
`apps/studio/tests/unit/m5-wo1-static.test.ts` (AST-based) covers the game, rules, materializer and source layers,
plus the catalog, documentation and CI contracts.

## 63. Negative Controls
§214–§230: all 17 were caught and every file was restored byte-for-byte (`scripts/m5-wo1-negative-controls.mjs`).
Static snippet controls cover them as well.

## 64. M4 Regression
All `@prowess/rules` suites (659), M4 static, final, API and negative-control gates are green. The M4 baseline hashes
are unchanged.

## 65. M4 Foundation Change Requests, if any
None.

## 66. Documentation
The five M5 docs, the baseline file, `ci.md` and this report.

## 67. Recommended M5 Dependency Order
WO2 → WO13 as in the system map. Rulings on the core conflicts come before WO2, and the weapon-AP ruling (M5-SC-026)
comes before WO11.

## 68. Local Verification
Green: frozen install, Prisma validate and generate, lint, architecture, typecheck, all package unit tests, database
integration (31 files, 507 tests), Studio unit (2,048), API integration (106), M4 and M5 negative controls, the
non-test reset refusal, and the production build. Playwright: 44 of 45 passed; see §69.

## 69. Sandbox / Environment Limitations
- Prisma's schema engine could not be downloaded (`binaries.prisma.sh` returned 403). Migrations were applied with
  `psql`, so the local drift check and guarded reset could not run; the guard itself passed. CI is the authority.
- The sandbox Chromium (build 1194) is older than Playwright's expected 1243. One layout assertion failed
  (`version-history.spec.ts` "comparison stacks vertically"). WO1 changes no UI file, so CI must confirm.
- The CI token was unavailable, so the branch is delivered as a git bundle for push.

## 70. GitHub Verification Needed
Push `m5-wo1`, open the PR, and confirm the full CI is green. That includes Prisma drift "No differences", the new
M5-WO1 gate, and Playwright.

## 71. Acceptance Criteria Status
Every criterion is met locally except those that need CI: Prisma drift, Playwright on the correct browser, and
permanent GitHub CI.
