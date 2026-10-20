# M5-WO6 Completion Report — Targeting Framework, Geometry, Range & Spell / Maneuver Targeting Catalogs

**WORK ORDER READY FOR CI VERIFICATION — M5-WO6**

- **Status:** passes locally. **FINAL PASS is not reported:** it requires the merge, a green CI run on the merged `main`
  and zero Prisma drift (§213).
- **M5-WO7:** not started (§214).

## 1. Base Commit / Branch

- **Baseline `main`:** `7784751c876cf42dec91108af8717a01f2e8e634`, the PR #46 merge (M5-WO5). It was verified with
  `git fetch` and matches the expected SHA; `main` had not advanced.
- **Branch:** `m5-wo6`, created from that commit. It holds one commit carrying the attribution lines.

## 2. Source Authority

Order of authority: designer rulings, then approved CanonDecisions, then Core Playtest V0.1, then older sources.

- **Rulings applied:** M5-SC-015, 016, 017, 018, 022, 024 and 029.
- **Spell locators:** s25, s628–s632, s750–s768, s772–s775 and s842.
- **Maneuver locators:** s1984, s1998–s2006 and s2027–s2029.
- **Chapter Book:** its Projectile 2 MP value was never used.

The values were checked against the Core Playtest text: the Targeting Types table, Spell Range and Area Scaling, the
Targeting Scaling table, Line of Sight / Effect and cover, and the AoE Maneuver Radius formula and origins.

## 3. Files Created

- **Domain code (`@prowess/game`):**
  - `packages/prowess-game/src/vocabulary/targeting.ts`
  - `packages/prowess-game/src/definition/targeting-payload.ts`
  - `packages/prowess-game/src/targeting/compile.ts`
- **Content:** `packages/prowess-game/src/content/core-playtest-v0.1/targeting.json`
- **Game tests:**
  - `packages/prowess-game/src/testing/targeting-fixtures.ts`
  - `packages/prowess-game/src/targeting-golden.test.ts`
  - `packages/prowess-game/src/targeting-contracts.test.ts`
- **DB tests:**
  - `packages/prowess-db/tests/fixtures/m5-wo6-targeting-catalog.ts`
  - `packages/prowess-db/tests/unit/m5-wo6-inspector-fixture.test.ts`
  - `packages/prowess-db/tests/integration/prowess-targeting-history.test.ts`
- **Studio tests:**
  - `apps/studio/tests/integration/m5-wo6-targeting-api.test.ts`
  - `apps/studio/tests/integration/fixtures/m5-wo6-targeting-plans.json` (generated)
  - `apps/studio/tests/unit/m5-wo6-static.test.ts`
  - `apps/studio/tests/unit/m5-wo6-audit-helpers.ts`
- **Script:** `scripts/m5-wo6-negative-controls.mjs`
- **Docs:**
  - `docs/architecture/m5-targeting-framework.md`
  - `docs/architecture/m5-wo6-baseline.json`
  - `docs/architecture/m5-wo6-completion-report.md`

## 4. Files Modified

- **`@prowess/game` source:**
  - `vocabulary/construction.ts`: adds PROJECTILE; TRIGGERED / ANCHOR are documented as historical.
  - `vocabulary/terminology.ts`: Trigger-Based and Glyph / Anchor become TARGETING_ADD_ON.
  - `definition/payload.ts`: reads `rules.targeting` and typed costs; forbidden keys gain saveProfile / saveProfiles /
    attackRolls.
  - `definition/codes.ts`: adds `TARGETING_ERROR_CODES`.
  - `internal/order.ts`: adds `TARGETING_ORDER`.
  - `index.ts`: exports the WO6 surface.
  - `vocabulary.test.ts`: the designer-clarification term list.
- **Studio audits:**
  - `m5-wo1-audit-helpers.ts`: the SHAPES set gains PROJECTILE and CHAIN.
  - `m5-wo1-static`, `m5-wo4-static`, `m5-wo5-static` and `m5-canon-rulings-static`: the catalog length goes 158 → 178,
    the WO1 guard-path pattern admits `wo6`, and the canon-rulings check now admits exactly the open conflicts
    M5-SC-039 and M5-SC-040.
- **CI:** `.github/workflows/ci.yml` (the new gate) and `docs/architecture/ci.md`.
- **Docs:**
  - `m5-invariants.md` / `.json`: I159–I178 appended.
  - `m5-core-playtest-source-conflicts.md`: M5-SC-039 / 040 and the WO6 update note.
  - `m5-core-playtest-system-map.md`: pointers updated.

## 5. Files Removed

None.

## 6. Database / Migration Status

There is no Prisma schema change and no migration; the schema hash and migrations are pinned by `m5-wo1-baseline.json`.

Both Targeting families are stored as ordinary EntityVersions, EntityType TARGETING, under
`structuredData.prowessDefinition`. No M5-WO6 DATA MODEL BLOCKER was raised.

## 7. Shared Targeting Contract

`rules.targeting` is a typed sub-contract inside the existing versioned TARGETING payload. It holds:

- `deliveryFamily`
- `cardinality`
- `validTargets`
- `range { model, formula | ruleText }`
- `measures[] { measure, valueStatus: FORMULA | DEFERRED_PENDING_CANON | EFFECT_DEFINED }`
- `origin { modes, default, sources, defaultSource }`
- `placement`
- `lineOfSight`, `lineOfEffect`, `cover`
- `radiusCapable`
- `parameters[]`
- `rankTables[]`

The LISTED costs stay on the existing `costContributions` field, typed as BASE, BASE_DEFERRED, PER_STEP,
PER_ADDITIONAL_TARGET or PER_SELECTION. Formulas are validated by M4's own `validateFormulaProgram`, and every variable
has a declared source: STAT, DERIVED, PARAMETER or SKILL_RANK_TABLE. The measure field is named `valueStatus` because
"status" is a forbidden Targeting key.

## 8. Branch Separation

SPELL_TARGETING and MANEUVER_TARGETING stay distinct DefinitionKinds. DEFAULT_SPELL_RANGE is Spell-only and
FOUNDATION_RANGE is Maneuver-only. A Spell Targeting Definition inside a Maneuver composition fails with the WO1
`CROSS_BRANCH_DEFINITION` error (golden §147).

## 9. Semantic Shape Vocabulary

The shapes are:

SELF, TOUCH, SINGLE_TARGET, MULTI_TARGET, PROJECTILE, LINE, CONE, RADIUS, ZONE, AURA, CHAIN

TRIGGERED and ANCHOR stay readable as historical shapes. `BASE_TARGETING_SHAPES` excludes them, and
`TARGETING_ADD_ONS` is TRIGGER / ANCHOR.

## 10. Projectile Canon

`spell.targeting.projectile` is a distinct Definition: semantic PROJECTILE, DIRECT_ATTACK_DELIVERY, one primary target,
default Spell Range, and Line of Sight / Effect REQUIRED. It is distinct from Single Target (golden §45).

## 11. M5-SC-039 Status

`UNRESOLVED`, newly added to the register.

- **Base contribution:** `BASE_DEFERRED { conflictKey: M5-SC-039 }`.
- **Result:** `cost.base.status = DEFERRED_PENDING_CANON`, plus an entry in `deferred[]`.
- **Guards:** the reader refuses a guessed second base, and the audit refuses a BASE amount on Projectile.
- **Follow-up:** M5-WO10 must resolve it.

## 12. Trigger / Glyph Correction

Designer ruling M5-SC-029 is applied.

- There is no canonical `trigger_based`, `glyph` or `anchor` Targeting Definition.
- Executable `rules.targeting` that uses TRIGGERED or ANCHOR is refused with `TARGETING_ADD_ON_AS_BASE`, and so is
  composing a WO1-era TRIGGERED or ANCHOR Targeting (goldens §141–§142).

## 13. Add-On Boundary

Only the vocabulary exists. There is no Add-On Definition system, and the +4 / +5 MP values are not used. Pricing is
deferred.

## 14. Spell Targeting Catalog

Self, Touch, Single Target, Multi-Target, Projectile, Line, Cone, Radius, Zone, Aura: 10 Definitions.

## 15. Targeting Cost Contributions

Self 0 · Touch 1 · Single Target 3 · Multi-Target 5 · Line 5 · Cone 5 · Radius 6 · Zone 8 · Aura 6 MP. Projectile is
deferred. These are reported only (golden §148).

## 16. Default Spell Range

`DEFAULT_SPELL_RANGE` reuses the WO2 `core.derived.base_range` statistic (`15 * per`) as its own M4 FORMULA step. That
step is bound into `base_range + range_extension * 15`. PER 4 gives 60 ft, and PER 7 gives 105 ft.

## 17. Range vs Area

Range and area are separate steps and separate outputs. PER 5 and PRO 3 give a range of 75 ft and a radius of 15 ft
(golden §130).

## 18. Self

Base 0 MP, one target, range model SELF, no area, and no M4 step at all.

## 19. Touch

Base 1 MP and one target. It adds no Attack Roll step and produces an empty plan.

## 20. Single Target

Base 3 MP, 60 ft at PER 4, one target, Line of Sight / Effect REQUIRED, and no Attack Roll.

## 21. Multi-Target

SELECTED cardinality on the `targetCount` COUNT parameter, minimum 2. No count is invented: an omitted count is
`NOT_SELECTED`, and a count of 1 is INVALID through an M4 REQUIREMENT. With a count of 3 the Targeting stays
MULTI_TARGET and no chain runs.

## 22. Projectile

At PER 4 it has one target and a 60 ft range, and its base cost is DEFERRED_PENDING_CANON (golden §135).

## 23. Line

LENGTH = `15 * pro + length_extension * 10`, so PRO 4 gives 60 ft. Base 5 MP. Scaling: +10 ft length → +3 MP and +5 ft
width → +4 MP.

## 24. M5-SC-040 Status

`UNRESOLVED`, newly added. WIDTH is `DEFERRED_PENDING_CANON` with the rule text "5 ft wide per 2 Prowess". No width step
is emitted.

## 25. Cone

LENGTH = `10 * pro + length_extension * 10`, so PRO 3 gives 30 ft and PRO 4 gives 40 ft. Base 5 MP.

## 26. Radius

RADIUS = `5 * pro`, so PRO 6 gives 30 ft. The center is a point chosen within default Spell Range. Base 6 MP.

## 27. Zone

RADIUS = `5 * pro`, so PRO 5 gives 25 ft. Base 8 MP. Mobile Zone is a FLAG at +5 MP. No Duration is inferred.

## 28. Aura

RADIUS = `5 * pro`, so PRO 4 gives 20 ft, and the Aura follows its source. Sources: CASTER by default; SUMMON / OBJECT /
ANCHOR at +4 MP (s631). Base 6 MP.

## 29. Targeting Scaling

The scaling options are declared parameters with typed costs:

- `rangeExtension`: +2 MP per 15 ft
- `lengthExtension`
- `widthExtension`
- `targetCount`: +3 MP per added target
- `mobile`
- `sourceRef`

Any undeclared parameter, such as `radius: 5000`, is refused with `UNDECLARED_TARGETING_PARAMETER`.

## 30. Widen Area Boundary

There is no radius or area expansion parameter or cost, so the superseded +10 ft → +3 MP rule is gone (M5-SC-024).
`radiusCapable` is true exactly when a RADIUS measure is authored (Radius, Zone, Aura, Maneuver Radius and Maneuver
Zone). Widen Area itself belongs to WO8.

## 31. Line of Sight

The policy is REQUIRED, NOT_REQUIRED, CONDITIONAL or INHERITED; Maneuver Targeting is INHERITED.

## 32. Line of Effect

It uses the same vocabulary and is structured per Definition.

## 33. Cover

The policy is EXPOSED_TO_RESOLUTION, NOT_APPLICABLE or INHERITED. It is resolution-neutral: Targeting never chooses a
Save or a Dodge value.

## 34. Valid Target Categories

SELF, CREATURE, OBJECT, POINT, SPACE, AREA, SOURCE.

## 35. Targeting Parameters

Parameters are COUNT, STEPS, FLAG or TOKEN, declared per Definition, with bounds checked by M4 REQUIREMENTs. Fractional
or negative values are refused.

## 36. Effect Compatibility Contract

A component's TARGETING compatibility matches the Targeting's exact canonical key or its semantic token. The check is an
M4 REQUIREMENT: ANY of the identity matches, or an explicit `targetingModifiers` entry. Each component is reported as
COMPATIBLE, INCOMPATIBLE, MODIFIED_BY_EXPLICIT_RULE or NOT_DECLARED.

## 37. Affinity Keyword Contribution

Only the Targeting Definition's authored Keywords are used. They go into one M4 KEYWORD step whose source is the exact
Targeting EntityVersion. Nothing is inferred from geometry; canonical content authors no Targeting Keywords yet.

## 38. Multi-Effect Shared Targeting

There is one Targeting slot (WO1). Every component that declares compatibility is checked against it, so there is no
per-Effect base Targeting.

## 39. Maneuver Targeting Catalog

Self, Touch, Single Target, Multi-Target, Line, Cone, Radius, Chain, Zone: 9 Definitions. There is no Aura. They carry no
cost and no Save Profile.

## 40. Maneuver Foundation Targeting

A Foundation's normal Targeting is explicit content: its own TARGETING compatibility. In the tests, a weapon attack
with SINGLE_TARGET is COMPATIBLE; with RADIUS it is INCOMPATIBLE unless an explicit Conversion modifier makes it
MODIFIED_BY_EXPLICIT_RULE.

## 41. Targeting Conversion Boundary

The Conversion is a Maneuver Effect (WO7) that owns the cost, the Save Profile and the slot. Putting a cost on
MANEUVER_TARGETING fails with `MANEUVER_TARGETING_COST`; putting a Save Profile on it fails with
`TARGETING_IMPLIES_OUTCOME`.

## 42. Maneuver Multi-Target

SELECTED cardinality with targetCount ≥ 2. The Definition grants no extra attacks or damage.

## 43. Maneuver Line

FOUNDATION_RANGE. LENGTH / WIDTH are EFFECT_DEFINED. Origins: PERFORMER, WEAPON_TIP, PROJECTILE_PATH, EMITTED_POINT.

## 44. Maneuver Cone

LENGTH is EFFECT_DEFINED. Origins: PERFORMER, WEAPON_DIRECTION.

## 45. Maneuver Radius

`rank_base * str` over the MARTIAL_RANK_BASE table. Origins: THROWN_IMPACT, RANGED_IMPACT, PROJECTILE_IMPACT,
PERFORMER, chosen explicitly or left to the Effect.

## 46. Maneuver Chain

CHAIN cardinality. The Effect defines jumps, damage, Save and cost.

## 47. Maneuver Zone

Range model EFFECT_DEFINED and RADIUS EFFECT_DEFINED. The Effect owns duration and behaviour.

## 48. Maneuver Radius Formula

- **Rank bases:** TRAINED 5, EXPERT 10, MASTER 15 ft, from the Martial Skill rank (M5-SC-018).
- **Goldens:** Trained STR 4 → 20 ft; Expert STR 4 → 40 ft; Master STR 4 → 60 ft; Master STR 10 → 150 ft; Expert STR 5 →
  50 ft.
- **STR bands:** never used. Trained STR 2 gives 10 ft and STR 7 gives 35 ft.
- **Untrained:** `NOT_AUTHORED_AT_RANK`.

## 49. M4 Formula Mapping

BASE_RANGE (the WO2 program), the range, and LENGTH / RADIUS are all M4 FORMULA steps over content programs. There is no
geometry arithmetic in TypeScript or in Studio.

## 50. M4 Requirement Mapping

- Multi-Target count / parameter bounds: `NUMERIC_COMPARE >=`.
- Compatibility: `ANY` / `SET_CONTAINS`.

## 51. M4 Keyword Mapping

One KEYWORD step for the authored Targeting Keywords.

## 52. Compilation Source Map

Every step cites its exact Targeting EntityVersion. Steps that read the base range or a rank table also cite
`core.derived.base_range` or `core.rank_ladder.skill`. The plan carries the Ruleset / Manifest / Release.

## 53. Rules Inspector Fixture

`m5-wo6-targeting-plans.json` is regenerated with `M5_WO6_WRITE_FIXTURE=1`. It holds three plans:

- Spell Radius at PER 5 / PRO 3: BASE_RANGE 75, range 75, radius 15, base 6 MP.
- Maneuver Radius at Expert / STR 5: 50 ft.
- Multi-Target with a count of 1: INVALID.

All values come from M4 through the existing endpoint.

## 54. Determinism

Equal requests give deep-equal plans, runs, results and source maps, and a plan replays through M4 identically after a
JSON round-trip.

## 55. Immutability

Inputs are never mutated, and outputs are deep-frozen.

## 56. Serialization

Every public contract survives `JSON.stringify` → `JSON.parse`.

## 57. Security

Getters, cycles, NaN, Infinity, functions and `__proto__` are all refused. Negative or fractional parameters are
refused, and so are undeclared parameters.

## 58. Historical Reproducibility

R1 re-evaluates deep-equal after R2 changes Radius to `10 * pro`. This is tested both in-memory and against the real
database (re-materialized Release).

## 59. Ruleset Isolation

Interleaved and concurrent R1 / R2 evaluations never mix. A bundle running under another Ruleset is refused.

## 60. New Invariants

M5-I159 to M5-I178 are appended after M5-I158; nothing was renumbered. The catalog now holds 178 entries, all ACTIVE and
guarded.

## 61. Conflict Register Changes

- M5-SC-039 and M5-SC-040 added as `UNRESOLVED`.
- A "M5-WO6 update" note added.
- All earlier text, including the source text, is preserved.

## 62. Terminology Changes

- **Projectile:** confirmed CANONICAL as a Spell Targeting shape (M5-SC-016).
- **Trigger-Based and Glyph / Anchor:** reclassified as TARGETING_ADD_ON (tokens TRIGGER / ANCHOR, M5-SC-029). Their
  historical TARGETING_SHAPE classification is recorded in a provenance comment.

## 63. Golden Tests

`targeting-golden.test.ts`: 27 tests covering §129–§148 and §78–§95.

## 64. Unit Tests

- `targeting-contracts.test.ts`: 47 tests.
- Totals: `@prowess/game` 505; model 513; rules 659; import 128; ui 21; db unit 90; studio unit 2608.

## 65. Integration Tests

- `prowess-targeting-history` (DB): 2 tests.
- `m5-wo6-targeting-api` (API): 5 tests.
- Studio integration overall: 125 of 125.
- DB integration overall: 507 pass. The 10 failures are the known local ledger checks (§77).

## 66. Static Audit

`m5-wo6-static.test.ts`: 41 tests. It covers:

- AST rules over the Targeting modules.
- Content rules over the catalog.
- No Studio geometry math.
- M4, schema, migration and endpoint baselines.
- The register, terminology, the I001–I178 catalog, the 36 doc sections and 5 diagrams, and the CI gate.
- In-memory controls.

## 67. Negative Controls

`scripts/m5-wo6-negative-controls.mjs` has 16 controls covering §174–§189; all were caught and restored byte-for-byte.

Earlier suites: WO1 17/17 · WO2 18/18 · WO3 21/21 · WO4 + canon rulings 34/34 · WO5 29/29 · M4 final restored.

## 68. M4 Regression

`@prowess/rules` is byte-identical to the WO2 baseline (65 files, same tree hash), and all M4 gates pass.

## 69. WO1 Regression

Branch kinds, the shared contract, exact Definitions, Targeting ≠ outcome and source mapping are all preserved. The only
change is the stronger forbidden-key list.

## 70. WO2 Regression

PER, PRO, Stats and BASE_RANGE are unchanged, and BASE_RANGE is reused.

## 71. WO3 Regression

Movement, terrain and the action economy are unchanged. No map engine was added.

## 72. WO4 Regression

Affinity Keyword resolution and access are unchanged; Targeting contributes explicit Keywords only.

## 73. WO5 Regression

One Targeting slot, legality, Authority, the Martial gate, prerequisites and Signature slots are all unchanged. The WO5
gate and its 29 controls pass.

## 74. Documentation

`docs/architecture/m5-targeting-framework.md` has all 36 sections and the 5 required diagrams (§195–§199). `ci.md`, the
system map, the invariants and the register were updated.

## 75. CI Gate

A new permanent step, **"M5-WO6 audit — Targeting framework, geometry & branch catalogs"**, runs after the M5-WO5 gate.
No gate was removed.

## 76. Local Verification

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | ✓ |
| lint | ✓ (0 warnings) |
| architecture | ✓ |
| typecheck | ✓ |
| unit (all packages) | ✓ |
| DB integration | ✓ except the 10 known ledger checks |
| Studio unit / static | ✓ |
| API integration | ✓ |
| M4 and M5-WO1–WO6 gates | ✓ |
| Negative controls (all) | ✓ |
| Non-test reset refusal | ✓ (exit 1, "Refusing …") |
| Production build | ✓ |
| Playwright | 45 passed |

## 77. Environment Limitations

- **Prisma engine blocked:** downloads from `binaries.prisma.sh` return 403. As a result:
  - `prisma validate` / `generate` cannot run;
  - the guarded `db:reset:test` (`prisma migrate reset`) cannot complete after its guard passes.
- **Local test DB:** rebuilt with psql from the migration SQL. It has no `_prisma_migrations` ledger, so the 10
  ledger-checking DB tests fail locally.
- **Unchanged inputs:** the schema and migrations are unchanged and hash-pinned.
- **Push blocked:** this session cannot push to GitHub (proxy 403), so delivery is a git bundle.

## 78. GitHub Verification Needed

Push `m5-wo6`, open the PR and get green PR CI (including Prisma validate / generate / drift, the guarded reset and the
ledger tests). Merge, then confirm green CI on the merged `main`. Only then report "M5-WO6 COMPLETE — READY FOR
M5-WO7".

## 79. Acceptance Criteria Status

Every §211 criterion is satisfied locally, except three that only GitHub can verify:

- Prisma drift reports no differences.
- The merged-`main` CI run succeeds.
- The previous permanent gates pass under real Prisma.

These are expected to pass because there is no schema or migration change.
