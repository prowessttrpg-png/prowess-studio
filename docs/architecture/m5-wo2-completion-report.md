# WORK ORDER READY FOR CI VERIFICATION — M5-WO2

**Status: not FINAL PASS.** That requires permanent GitHub CI to be green on merged `main`.

## 1. Base Commit / Branch

- **Base:** `f2f980d2f57142f09f7c83e6335b4adaef98b7c0`, the M5-WO1 merge. Main had not advanced.
- **Branch:** `m5-wo2`, one commit.

## 2. Source Authority

The M5-WO1 hierarchy is unchanged:

1. designer clarifications (here: the M5-WO2 rulings);
2. approved CanonDecisions;
3. Core Playtest V0.1 (`21fa6771…`, structure `3d9a429c…`);
4. older sources.

Source text is unchanged. Every core Definition cites its `sNNN` locators and the conflicts it applies.

## 3. Designer Rulings Applied

M5-SC-002, 003, 005, 008, 009 and 010 are applied. See the table in `m5-core-resolution-stats-dice-ranks.md` §3.

## 4. Source Conflict Register Updates

- The six rulings above are now `RESOLVED_BY_DESIGNER`. Each entry records the exact ruling and keeps its source
  A / B locators.
- M5-SC-006 stays `UNRESOLVED` and is marked `DEFERRED_PENDING_CANON`.
- M5-SC-030 has a clarifying note and stays UNRESOLVED.
- **New M5-SC-032** (UNRESOLVED): Advantage + Disadvantage on the same roll.

## 5. Remaining WO2-Relevant Conflicts

- **M5-SC-006** — Movement is deferred.
- **M5-SC-032** — both roll signals at once fails closed.
- **M5-SC-007** (Concentration) and **M5-SC-011** (Arcane / Arcana Rank) are untouched.
- **M5-SC-030** — WO2 needs only Skill canonical keys.

## 6. Files Created

- **`packages/prowess-game/src/`:**
  - `core/{compile,character,dice,definitions,ranks}.ts`;
  - `definition/core-payload.ts`, `vocabulary/core.ts`;
  - `content/core-playtest-v0.1/core-resolution.json` — the 30 canonical Definitions;
  - `testing/{core-fixtures,core-run}.ts`;
  - `core-resolution-golden.test.ts`, `core-contracts.test.ts`.
- **`packages/prowess-db/tests/`:**
  - `integration/prowess-core-resolution-history.test.ts`;
  - `unit/m5-wo2-inspector-fixture.test.ts`.
- **`apps/studio/tests/`:**
  - `unit/m5-wo2-static.test.ts`, `unit/m5-wo2-audit-helpers.ts`;
  - `integration/m5-wo2-core-api.test.ts`, `integration/fixtures/m5-wo2-core-plans.json`.
- **`scripts/m5-wo2-negative-controls.mjs`.**
- **`docs/architecture/`:** `m5-core-resolution-stats-dice-ranks.md`, `m5-wo2-baseline.json`, and this report.

## 7. Files Modified

- **`@prowess/game`:**
  - `vocabulary/families.ts` — activated STAT / DERIVED_STAT / SKILL_RANK / CORE_RESOLUTION v1, and added
    CHARACTER_DIE_PROGRESSION and RANK_LADDER (29 → 31 kinds);
  - `vocabulary/terminology.ts` — the rulings, plus `legacyTermFor` separator normalisation;
  - `definition/{payload,codes}.ts` — the core payload hook, plus the `INVALID_FORMULA`, `DEFERRED_PENDING_CANON` and
    `CORE_ERROR_CODES` diagnostics;
  - `compilation/assemble.ts` — subject-neutral `assembleFragments`, shared by both compilers;
  - `compilation/compile.ts` — two null table slots;
  - `internal/problems.ts` — canonical keys now refuse prototype segments;
  - `index.ts` — the explicit WO2 exports.
- **Deliberate WO1 test updates:**
  - `vocabulary.test.ts` — the rulings replace "left UNRESOLVED";
  - `apps/studio/tests/unit/m5-wo1-static.test.ts` — 74 invariants; WO2 controls script allowed as a guard;
  - `scripts/m5-wo1-negative-controls.mjs` — §217 anchor follows the `compiledStepKey` parameter rename.
- **Docs:** `m5-core-playtest-source-conflicts.md`, `m5-invariants.{md,json}`, `ci.md`.
- **CI:** `.github/workflows/ci.yml` — the new gate.

## 8. Files Removed

None.

## 9. Database / Migration Status

No schema change and no migration. Core Definitions are ordinary EntityVersions (`structuredData.prowessDefinition`,
EntityType `GENERIC_RULE`). There is no DATA MODEL BLOCKER.

## 10. Character Die Domain

`{dieKey, faces}` dice: D4, D6, D8, D10 and D12. The resolved die is `{dieKey, faces, levelMinimum, levelMaximum}`.
Identity is the token plus faces, never a display string.

## 11. Player Dice Legacy Mapping

- Player Die → LEGACY → Character Die.
- Player Dice → LEGACY → Character Dice.

There is one progression. Golden §142: a d10 character's "1 Player Die" is 1d10.

## 12. Level / Character Die Progression

The bands come from the `CHARACTER_DIE_PROGRESSION` content: L1–2 d4 · L3–4 d6 · L5–6 d8 · L7–8 d10 · L9–10 d12.
Levels outside 1–10 are refused.

## 13. Half Character Die

`die_faces / 2` as an M4 FORMULA, with no roll: 2 / 3 / 4 / 5 / 6.

## 14. Ability Score Domain

There are six STAT Definitions, each bounded 1–10. Stats are identities of `@prowess/game` only.

## 15. Rank Domain

`RANK_LADDER` SKILL is `UNTRAINED 0 < TRAINED 1 < EXPERT 2 < MASTER 3` (order only). `rankAtLeastRequirement` /
`rankFact` compile rank requirements to M4 `RANK_AT_LEAST`.

## 16. Skill Rank Bonuses

`SKILL_RANK` gives 0 / 2 / 4 / 6. UNTRAINED has `attemptAllowed: false`, which needs explicit `attemptPermitted`.

## 17. Core Roll Contract

`compileCoreResolution` with `CORE_RESOLUTION / CORE_ROLL`, plus mode and Stat. The plan's steps are natural
selection, named bonus sum, total, and success (`>=` DC).

## 18. Runtime Dice Input Contract

`ProwessDieRollInput {die, mode, rolls[]}` is checked by `validateDieRollInput`: 1 or 2 rolls depending on mode, each
an integer from 1 to faces, on the character's die. `buildCoreResolutionContexts` also checks that the roll's mode
matches the plan's mode.

## 19. Advantage

M4 FORMULA `max(r1, r2)`. Modifiers are added once, in the total step.

## 20. Disadvantage

M4 FORMULA `min(r1, r2)`.

## 21. Advantage/Disadvantage Unresolved Interaction

When both are present, `resolveRollMode` fails with `PROWESS_CORE.ROLL_MODE_CONFLICT`. This is M5-SC-032. Nothing
cancels.

## 22. Skill Check

The total is `natural + stat_score + rank_bonus + bonuses`. The Stat is chosen by the approach, and the Skill is an
exact canonical key.

## 23. Automatic Skill Success

`SKILL_AUTOMATIC_SUCCESS`: `stat_score + rank_bonus >= DC`, with no die. A Skill Check plan exposes both fragments,
and both run; there is no hidden branch.

## 24. Saving Throw

The total is `natural + stat_score + bonuses`. The Save Stat must be explicit and can be any of the six.

## 25. Attack Roll

The total is `natural + per + accuracy + bonuses`, compared `>=` with the target's Dodge.

## 26. Prowess Accuracy

The `ACCURACY` statistic, `floor(pro / 3)`, is its own step and its own term.

## 27. Dodge

`half_character_die + agi + perception_bonus + bonuses`, where the PER term is the `DODGE_PERCEPTION_BONUS`
statistic.

## 28. Evasion Legacy Mapping

Evasion → LEGACY → Dodge. There is no second value (control §188).

## 29. Critical Threat

M4 REQUIREMENT: the selected natural `==` faces.

## 30. Critical Hit

M4 `ALL` REQUIREMENT of the threat and the hit. Damage is deferred.

## 31. Character DC

`half_character_die + pro + resolve_bonus + bonuses`. It is static.

## 32. Resolve DC Bonus

The `CHARACTER_DC_RESOLVE_BONUS` statistic, `floor(res / 3)`.

## 33. HP Derivation

`base_hp + con`.

## 34. MP Derivation

`base_mp + res`.

## 35. Strength Armor

`floor(str / 3)`.

## 36. Agility AP Bonus

`floor(agi / 3)`.

## 37. Base AP Capacity

`3 + agility_bonus`.

## 38. Counter Action Base Capacity

`1`.

## 39. Base Range

`15 * per`, unit `ft`.

## 40. Mana Efficiency Base Value

`pro`. It is payment, never a discount (control §199).

## 41. Signature Ability Capacity

`pro`.

## 42. Stat Mastery

An M4 MODIFIER `ROLL_SIGNAL` producing ADVANTAGE when Level ≥ 10 and the Stat ≥ 10. It is never numeric.

**Dynamic-signal limitation:** the signal cannot pick between Formula programs inside one plan. The caller runs
`resolveRollMode` and recompiles. This is documented; M4 was not extended.

## 43. Movement Deferral / M5-SC-006

There is no Movement Definition and no executable formula. A MOVEMENT / BASE_MOVEMENT / MOVEMENT_SPEED DERIVED_STAT is
refused with `DEFERRED_PENDING_CANON`. Guarded by M5-I073 and control §198.

## 44. M4 Formula Mapping

Every arithmetic rule is an M4 FORMULA: natural selections, totals, half die, HP, MP, Accuracy, Dodge and its PER
term, the Resolve DC bonus, Character DC, Strength Armor, AP, Counter Action, Range, ME, slots, and named bonus sums.

## 45. M4 Requirement Mapping

- success: total `>=` DC or Dodge;
- critical threat: natural `==` faces;
- critical hit: `ALL`;
- automatic success: `>=` DC;
- rank requirements: `RANK_AT_LEAST`;
- Stat Mastery conditions.

## 46. Modifier / Roll-Signal Mapping

Stat Mastery uses a MODIFIER with a `ROLL_SIGNAL` target and an `ALL` condition. M4's generic signal meaning is
unchanged; the Prowess interpretation lives in `resolveRollMode`.

## 47. Resource Boundary

Only capacities are derived (all FORMULA). No Resource transition is compiled. WO3 owns runtime Resources.

## 48. Compilation Fragments

| Fragment | Order |
| --- | --- |
| `bonuses.<TARGET>` | −1 |
| `derived.<STAT>` | 0…n, in M4 dependency order |
| `stat-mastery` | 1000 |
| `natural` | 1010 |
| `total` / `automatic.total` | 1030 |
| `success` / `critical-threat` / `automatic.success` | 1040 |
| `critical-hit` | 1050 |

Step keys are `prowess:<subjectKind>:<subjectKey>:<fragment>`.

## 49. ProwessCompilationSourceMap

There is one entry per step, naming its component keys and exact Definition refs. M4 `RuleProvenance` is on every
program and Requirement.

## 50. Determinism / RNG Audit

No RNG, clock or module state. The static audit and controls §184 / §185 guard this. Plans and runs are deep-equal
when repeated.

## 51. Security / Plain-Data Audit

Every input is checked with the WO1 plain-data checks, and unknown fields are refused. Tests cover getters,
`__proto__`, cycles, functions, non-finite numbers, wrong types, oversize labels and hostile skill / bonus keys.

## 52. Immutability

Outputs are deep-frozen and inputs are never frozen. Caller mutation after compiling does not change the plan.

## 53. Serialization

Every plan and fixture round-trips through JSON. The API fixture is regenerated and compared each run.

## 54. Historical Reproducibility

The database test publishes R1 with all 30 Definitions and evaluates it. It then publishes R2 with changed Accuracy
and Counter Action values. Re-evaluating R1 gives an identical bundle, plan and run.

## 55. Ruleset Isolation

R1 and R2 materialize and evaluate concurrently. Source maps cite only their own versions. Running R1's bundle under
R2's context fails.

## 56. New M5 Invariants

M5-I041–I074 are appended in md and json; M5-I001–I040 are unchanged. Every new invariant has executing guards.

## 57. Tests Added

| Suite | Tests |
| --- | --- |
| `@prowess/game` golden | 41 |
| `@prowess/game` contracts | 42 |
| DB integration | 2 |
| DB unit (fixture) | 1 |
| API integration | 3 |
| M5-WO2 static audit (includes 44 in-memory controls) | 127 |
| Behavioural negative controls | 18 |

`@prowess/game` now has 154 tests in total.

## 58. Golden Fixtures

§123–§142 are all present in `core-resolution-golden.test.ts`, plus §109 (the Character DC explanation example) and
§70 (criticals use the selected natural).

## 59. Static Architecture Audit

`m5-wo2-static.test.ts` contains:

- AST rules over `@prowess/game` and `@prowess/rules`;
- structural rules over the content;
- the frozen M4 tree hash and the route inventory;
- the schema and migrations;
- the conflict, terminology, invariant, documentation and CI contracts.

It covers every item in §182.

## 60. Negative Controls

All 18 behavioural controls (§183–§200) were caught and each file was restored byte-for-byte
(`scripts/m5-wo2-negative-controls.mjs`).

## 61. M4 Regression

- `@prowess/rules` 659 tests are green, and its source tree hash is unchanged.
- All M4 static, final, API and negative-control gates are green.

## 62. M5-WO1 Regression

All WO1 suites, the static audit and the 17 controls are green.

## 63. Documentation

`m5-core-resolution-stats-dice-ranks.md` has 30 sections and the §213–§220 diagrams. The conflicts register,
invariants, `ci.md` and this report were updated.

## 64. Local Verification

Green:

- frozen install;
- Prisma validate and generate;
- lint, architecture and typecheck;
- all package unit tests (game 154, rules 659, db 86, model 513, import 128, ui 21);
- Studio unit (2,182);
- DB integration (32 files, 509 tests);
- API integration (19 files, 109 tests);
- M4 final, M5-WO1 and M5-WO2 negative controls;
- the non-test reset refusal;
- the production build;
- Playwright: 45 of 45.

## 65. Sandbox / Environment Limitations

- **Prisma:** the schema engine cannot be downloaded (403), so the guarded reset and the drift check cannot run
  locally. Migrations were applied with `psql`.
- **Local test database:** it held stale rows from earlier e2e sessions, so it was truncated (test database only)
  before the integration run.
- **Playwright:** it ran on the sandbox's linked Chromium headless shell and all 45 passed. CI's browser is the
  authority.
- **Push:** there is no push credential in the sandbox, so the branch is delivered as a git bundle.

## 66. GitHub Verification Needed

Push `m5-wo2`, open the PR, and confirm the full CI is green. That includes:

- Prisma drift "No differences";
- the M5-WO1 and new M5-WO2 gates;
- every M4 gate;
- the production build;
- Playwright.

## 67. Acceptance Criteria Status

Every §227 criterion is met locally. The exceptions need CI: Prisma drift, Playwright on the correct browser, and
permanent GitHub CI. M5-WO3 was not started.
