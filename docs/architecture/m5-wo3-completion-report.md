# WORK ORDER READY FOR CI VERIFICATION — M5-WO3

Runtime Resources, Action Economy, Movement & Roll-State Resolution. This is not FINAL PASS: permanent merged-main
GitHub CI has not run yet. M5-WO4 has not been started.

## 1. Base Commit / Branch

- Base: `main` at `dc2f0aadbdbd15a070566681758a375910611c73` (the M5-WO2 merge, verified before any change).
- Branch: `m5-wo3`. One commit on top of the base.

## 2. Source Authority

The precedence is:

1. Designer rulings (M5-WO3 §4–§15).
2. CanonDecisions (none new).
3. Core Playtest V0.1.
4. Older material.

Every locator was re-read from the designer's verified Core Playtest bytes (SHA-256 prefix `21fa6771`), parsed with
`prowess-docx-structure@1.0.0` (2,487 sections, identical to M3-WO9).

New locators used:

- s43–s55
- s69–s71
- s101–s111
- s228
- s423–s442
- s485
- s643–s649

## 3. Designer Rulings Applied

- M5-SC-006: Base Movement = 5 ft × AGI.
- Size may modify Movement (values pending).
- M5-SC-032: Advantage and Disadvantage are presence-based and non-stacking; both present → NORMAL.

## 4. M5-SC-006 Resolution

- Status: `RESOLVED_BY_DESIGNER`, authority M5-WO3 §4–§6.
- Canonical Definitions: `core.derived.base_movement` (`5 * agi`, ft, rounding NONE) and `core.derived.final_movement`
  (`base_movement + bonuses`).
- The 10 × AGI example (s156) is superseded and stays visible in the register.
- `DEFERRED_STATISTICS` is now empty.
- The WO2 text in the register is kept verbatim. The WO3 ruling is appended.

## 5. M5-SC-032 Resolution

- Status: `RESOLVED_BY_DESIGNER`, authority M5-WO3 §8–§15.
- `resolveRollSignals` and `resolveRollMode` resolve by presence.
- `PROWESS_CORE.ROLL_MODE_CONFLICT` is removed.
- The register records that WO2 correctly failed closed while the question was pending.
- M4 Modifier semantics are unchanged.

## 6. M5-SC-033 Status

- New, `UNRESOLVED`: Size-based movement adjustment values.
- `CREATURE_SIZE.movementAdjustment` must be null. Any value is refused as `DEFERRED_PENDING_CANON`.
- The runtime content records it as deferred.

Also new: **M5-SC-034** (UNRESOLVED), raised by the source audit.

- s71 and s228 say Sprint quadruples **Base** Movement. s438 and s485 say **Total** Movement.
- Repeated-Sprint stacking is unstated.
- WO3 follows §73 (`final_movement * 4`) and §75: each Sprint is a separate execution, so the result is linear.
- The two readings differ only when an explicit Movement modifier exists.
- **Designer confirmation is requested.**

## 7. Invariant Supersession Handling

- M5-I073 keeps its id, title, guards and text.
- In the JSON it gains `"status": "SUPERSEDED", "supersededBy": "M5-I075"`. The catalog format is extended with these
  two optional fields; an entry without them is ACTIVE.
- The Markdown gains a `**Status:** SUPERSEDED by M5-I075` line.
- The WO2 audit retired its Movement rule and records the supersession.
- WO2 negative control §198 now pins "10 × AGI is never canonical".

## 8. Files Created

`packages/prowess-game/src/`:

- `runtime/{compile,definitions,resources,results,combat}.ts`
- `definition/runtime-payload.ts`
- `vocabulary/runtime.ts`
- `internal/order.ts`
- `content/core-playtest-v0.1/runtime-resources.json`
- `testing/runtime-run.ts`
- `runtime-resources-golden.test.ts` (56 tests)
- `runtime-contracts.test.ts` (30 tests)

`packages/prowess-db/tests/`:

- `integration/prowess-runtime-resources-history.test.ts`
- `unit/m5-wo3-inspector-fixture.test.ts`

`apps/studio/tests/`:

- `unit/m5-wo3-static.test.ts` (131 tests)
- `unit/m5-wo3-audit-helpers.ts`
- `integration/m5-wo3-runtime-api.test.ts`
- `integration/fixtures/m5-wo3-runtime-plans.json`

Elsewhere:

- `scripts/m5-wo3-negative-controls.mjs`
- `docs/architecture/m5-runtime-resources-action-economy.md`
- `docs/architecture/m5-wo3-baseline.json`
- this report

## 9. Files Modified

`@prowess/game`:

- `vocabulary/{core,families,terminology}.ts`
- `definition/{codes,core-payload,payload}.ts`
- `core/{compile,dice}.ts`
- `compilation/compile.ts` (null compilers for the new kinds)
- `internal/plain-data.ts` (`canonicalJsonOf`)
- `testing/core-fixtures.ts`
- `index.ts`
- `content/core-playtest-v0.1/core-resolution.json` (BASE_MOVEMENT, FINAL_MOVEMENT and INITIATIVE appended; rulings and
  deferrals updated)

WO1 and WO2 guards and tests (narrow, superseded behaviour only):

- `core-contracts.test.ts`
- `core-resolution-golden.test.ts`
- `vocabulary.test.ts`
- `m5-wo1-static.test.ts`
- `m5-wo2-static.test.ts`
- `m5-wo2-audit-helpers.ts`
- `m5-wo2-negative-controls.mjs`
- `m5-wo2-core-plans.json` — regenerated. Only the `order` positions changed, because the derived graph grew. Every
  value is identical.

Docs and CI:

- `m5-core-playtest-source-conflicts.md`
- `m5-invariants.{md,json}`
- `ci.md`
- `.github/workflows/ci.yml`

## 10. Files Removed

None.

## 11. Database / Migration Status

- No schema change and no migration. `schema.prisma` and the migration hashes still match `m5-wo1-baseline.json`.
- No Encounter table.
- RESOURCE Definitions use the existing M1 `RESOURCE` EntityType. Every other kind uses `GENERIC_RULE`.
- No data-model blocker.

## 12. Resource Definition Contract

`RESOURCE` v1 (stored under EntityType RESOURCE) has these fields:

- resourceKey
- m4Kind
- minimum
- maximum (`DERIVED` statistic | `UNBOUNDED`)
- refresh[] (timing, target)
- expiry[] (timing, setTo MINIMUM, preservableByExplicitRule)
- spending (DIRECT / PAYMENT_ONLY / NONE)
- restoration (ceiling, overflow) | null
- supportsReservation
- payment[] (policy, order)
- usageRestrictions[]
- exposesDepletion
- rules
- source

It never holds a current value.

## 13. Action Definition Contract

`ACTION` v1 has these fields:

- actionKey
- timing (OWN_TURN / OUTSIDE_OWN_TURN)
- actionPointCost (FIXED / RANGE / MINIMUM / VARIABLE / NONE)
- otherCosts[] (costKey, policy, amount)
- movementGrant (an M4 Formula over DERIVED statistics) | null
- requiresTrigger
- costOverridableByExplicitRule
- rules
- source

## 14. Creature Size Contract

`CREATURE_SIZE` v1 (`GENERIC_RULE`) is a narrow new kind with these fields:

- sizeKey
- occupiedSpaceFeet (as written: [5] or [10, 10])
- orLarger
- movementAdjustment, which must be null
- rules
- source

`TERRAIN` v1 is also new: terrainKey and allowanceCost (an M4 Formula over MOVEMENT_DISTANCE).

## 15. HP Runtime Model

- POOL, 0 ≤ current ≤ MAXIMUM_HP.
- No refresh or expiry.
- Spend is atomic; restore is clamped to the nominal maximum.
- Depletion is exposed.

## 16. MP Runtime Model

- POOL with maximum MAXIMUM_MP.
- No refresh.
- Restore is bounded by the available maximum.
- Reservation is supported.
- Pays MAGICAL_COST (order 0) and ME_ELIGIBLE_MAGICAL_COST (order 1).

## 17. ME Runtime Model

- TEMPORARY_POOL with maximum = BASE_MANA_EFFICIENCY (= PRO).
- Refreshes to maximum at START_OF_ROUND.
- Pays ME_ELIGIBLE_MAGICAL_COST at order 0.

## 18. AP Runtime Model

- ACTION with maximum = BASE_AP_CAPACITY.
- Refreshes at START_OF_TURN.
- Spent through ACTION_POINT_COST payments, as points in any order.

## 19. Counter Action Runtime Model

- SLOT with maximum = COUNTER_ACTION_CAPACITY (1).
- Refreshes at START_OF_ROUND.
- PAYMENT_ONLY, so the Surprise restriction is always checked.
- No restoration, so no banking.
- `action.counter_reaction` needs a trigger and spends no AP.

## 20. Movement Allowance Model

- TRACKER, unbounded.
- Granted by M4 RESTORE from a Move or Sprint follow-on.
- Spent per segment.
- Expires at END_OF_TURN.
- Never persisted, never a statistic.

## 21. Refresh Timing

`RESOURCE_TIMING` acts on every supplied Resource's authored rule at the event:

| Event | Effect |
| --- | --- |
| START_OF_ROUND | ME and Counter Action refresh; Counter availability is checked |
| START_OF_TURN | AP refreshes |
| END_OF_TURN | AP and movement allowance go to their minimum |
| END_OF_ROUND | timing identifier only |

HP and MP never have a timing rule.

## 22. AP Expiry

M4 SET_CURRENT to the minimum at END_OF_TURN. An explicit `preserve` (with its source rule) skips the expiry, and only
where the Definition allows it.

## 23. Counter Expiry

Refresh to Capacity never raises it above Capacity: 1 unused + capacity 1 → 1.

## 24. ME → MP Payment Priority

- `MAGICAL_PAYMENT` requires an explicit `meEligible`.
- When it is true, the payment uses ME_ELIGIBLE_MAGICAL_COST: ME at order 0, then MP at order 1.
- Golden: listed 8, ME 5 and MP 18 → paid ME 5 and MP 3 → ME 0, MP 15. The listed cost stays 8.

## 25. Payment Atomicity

M4 `canPay: false` leaves the state unchanged.

- Golden (listed 10, ME 3, MP 4): shortfall 3, nothing changes.
- `confirmActionPayment` returns the original state for CANNOT_PAY and for UNAVAILABLE.

## 26. MP Reservation Boundary

| Case | Before | Operation | After |
| --- | --- | --- | --- |
| Reserve | maximum 20, current 18 | reserve 6 | reserved 6, available 14, current 18 |
| Release | current 9, reserved 6 | release 6 | available 20, current 9 |

There is no Mana Lock compiler.

## 27. Common Action Catalog

13 ACTION Definitions:

- `action.move`
- `action.sprint`
- `action.attack.light`
- `action.attack.balanced`
- `action.attack.heavy`
- `action.block`
- `action.dodge` (`DODGE_ACTION`)
- `action.reload`
- `action.interact`
- `action.grapple`
- `action.cast_spell`
- `action.use_skill`
- `action.counter_reaction`

## 28. Fixed Action Costs

| Action | AP |
| --- | --- |
| Move | 1 |
| Sprint | 3 |
| Light Attack | 1 |
| Balanced Attack | 2 |
| Heavy Attack | 3 |
| Block | 2 |
| Dodge Action | 3 |
| Reload | 1 |

Sources are s44 and s432. A cost can be overridden only through `costOverride` with a source key. M5-SC-026 and
M5-SC-027 stay UNRESOLVED for Equipment.

## 29. Variable Action Costs

| Action | Model |
| --- | --- |
| Interact | MINIMUM 1 |
| Grapple | RANGE 1–2 |
| Cast Spell | VARIABLE (SPELL) |
| Use Skill Action | VARIABLE (SKILL_ACTION) |

The caller supplies the chosen or determined cost explicitly; it is checked against the authored bounds. A VARIABLE
cost needs a `costSourceKey`.

## 30. Base Movement

M4 FORMULA. Golden results:

| AGI | Base Movement |
| --- | --- |
| 1 | 5 ft |
| 2 | 10 ft |
| 4 | 20 ft |
| 6 | 30 ft |
| 10 | 50 ft |

## 31. Size Movement Boundary

- The pipeline is Base → Size (pending) → explicit modifiers → Final.
- FINAL_MOVEMENT reads only BASE_MOVEMENT and explicit MOVEMENT bonuses.

## 32. Occupied Space

| Size | Space (s442) |
| --- | --- |
| Small | 5 ft |
| Medium | 5 ft |
| Large | 10×10 ft |
| Huge | 15×15 ft |
| Massive | 20×20 ft or larger |

Occupied space is never read as speed.

## 33. Move Action

Golden: AP 3 → pay 1 → AP 2. The PAID follow-on grants +20 ft of allowance (AGI 4).

## 34. Split Movement

Golden: allowance 20 → move 10 → Light Attack → move 10 → 0. No second Move cost. Overspending is `applied: false`
with a shortfall.

## 35. Difficult Terrain

- `terrain.difficult` cost is `distance * 2`.
- Golden: 5 ft consumes 10 ft, so 20 → 10.
- Hazardous Terrain effects are deferred.

## 36. Sprint

- 3 AP. Grant is `final_movement * 4`. AGI 4 → 80 ft.
- Two Sprints at AGI 9 → 180 + 180 = 360 ft (linear).
- See M5-SC-034.

## 37. Combat Round Model

- `COMBAT_ROUND_SEQUENCE`, in order:
  1. Determine Surprise
  2. Roll Initiative
  3. First Side Acts
  4. Next Side Acts
  5. End of Round
  6. Refresh and Repeat
- Timing events: START_OF_ROUND, START_OF_TURN, END_OF_TURN, END_OF_ROUND.
- Side phases: `createSidePhase`.

## 38. Initiative

- CORE_RESOLUTION `INITIATIVE`, compiled by the WO2 core compiler as FORMULA steps only.
- Total: `natural + per / 2 + agi / 2 + bonuses`, rounding NONE.
- Golden: 10. Fractional totals such as 7.5 are kept.
- The die result is runtime input.

## 39. Initiative Tiebreak

- `resolveInitiativeOrder` follows the Definition's `tiebreak`: HIGHEST PER, then HIGHEST AGI, then REROLL. It uses
  comparisons only.
- Golden: tie on total → side A first by PER 5 vs 4. Full tie → `REROLL_REQUIRED` (not generated).

## 40. Shared Player Phase

- A side phase is a set: `orderPolicy CHOSEN_BY_SIDE`, `actingOrder null`, never sorted.
- C → A → B is accepted. A creature may wait.
- Interleaving needs `interleavingApproved`.

## 41. Surprise

- The Counter Action carries the restriction `SURPRISED` with `throughRound 1`, as a Requirement.
- In round 1 it refreshes to 1 but is UNAVAILABLE. In round 2 it is available.
- No AP penalty: a surprised creature's AP refreshes to full Capacity.

## 42. Roll-Signal Aggregation

`resolveRollSignals(M4 ROLL_SIGNAL state)` returns:

- `mode`
- the sorted Advantage sources and the sorted Disadvantage sources
- `cancelled`
- `ruling`

## 43. Advantage Cancellation

All 10 §119 cases pass, including 2A + 1D → NORMAL and 1A + 3D → NORMAL. No count is compared or subtracted.

## 44. Signal Provenance

Golden §120: Stat Mastery and High Ground vs Poisoned → NORMAL, with all three sources retained.

## 45. M4 Resource Mapping

| Resource | M4 kind |
| --- | --- |
| HP | POOL |
| MP | POOL |
| ME | TEMPORARY_POOL |
| AP | ACTION |
| COUNTER_ACTION | SLOT |
| MOVEMENT_ALLOWANCE | TRACKER |

Operations used: SPEND, RESTORE, SET_CURRENT, REFRESH, RESERVE / RELEASE_CAPACITY, PAYMENT_PREVIEW / APPLY.

## 46. M4 Formula Mapping

FORMULA is used for the capacities (WO2), BASE_MOVEMENT, FINAL_MOVEMENT, the Initiative total, movement grants and
terrain costs. REQUIREMENT is used for Surprise availability and depletion.

## 47. Compilation Fragments

`compileRuntime` subjects and the fragment families they cover:

| Subject | Fragment family |
| --- | --- |
| RESOURCE_STATE | RESOURCE_INITIALIZATION |
| RESOURCE_TIMING | ROUND / TURN_REFRESH |
| RESOURCE_TRANSITIONS | RESOURCE_TRANSITION |
| MAGICAL_PAYMENT | MAGICAL_PAYMENT |
| ACTION_PAYMENT | ACTION_PAYMENT |
| ACTION_FOLLOW_ON | MOVEMENT_ALLOWANCE |
| MOVEMENT | MOVEMENT_ALLOWANCE |

MOVEMENT_BASE and INITIATIVE go through `compileCoreResolution`. ROLL_STATE_RESOLUTION is `resolveRollSignals`.

Each plan is a chain of M4 Resource operations. No M4 code changed: the `@prowess/rules` source-tree hash is identical
to the WO2 baseline. **No M4 Foundation Change Request was needed.**

## 48. ProwessCompilationSourceMap

- Exactly one entry per step.
- Each entry cites the exact RESOURCE, ACTION and TERRAIN Definitions and the derived-stat Definitions it binds.
- Every citation is a bundle EntityVersion.

## 49. Runtime Persistence Boundary

- No endpoint, schema, persistence path or save / commit API was added.
- Through `POST /api/rules/evaluate`, every table's fingerprint is unchanged.
- Release evaluation leaves the row counts unchanged.

## 50. Zero-HP / Death-and-Dying Boundary

- A `depletion` Requirement reports HP == 0 (golden: spend 5 of 5 → depleted).
- There is no Downed, Death Save or Lethal logic. Overkill damage is deferred.

## 51. New M5 Invariants

- M5-I075–M5-I110 are appended. Each has guards; every guard file contains the invariant's id.
- M5-I001–I110 are all present.
- M5-I073 is SUPERSEDED.

## 52. Tests Added

| Suite | Tests |
| --- | --- |
| Golden | 56 |
| Runtime contracts | 30 |
| WO3 static audit (including 41 in-memory controls) | 131 |
| Inspector fixture | 1 |
| DB history | 2 |
| API | 4 |
| Behavioural negative controls | 21 |

## 53. Golden Fixtures

§105–§125 and §61 all pass. They are listed in sections 30–44.

## 54. Static Architecture Audit

The audit is `m5-wo3-static.test.ts` (with `m5-wo3-audit-helpers.ts`). It checks every item in §195, including:

- persistence;
- action and resource-name switches;
- listed-cost feedback;
- MP before ME;
- banking;
- RNG;
- player ordering;
- 10 × AGI;
- Size speed;
- stacking and netting;
- the frozen M4 hash, routes, schema and migrations;
- the register, invariants (I073 superseded), terminology, documentation and CI.

## 55. Negative Controls

- `scripts/m5-wo3-negative-controls.mjs`: all 21 controls (§174–§194) were caught and restored byte-for-byte.
- WO2 script: 18 / 18 caught, with §198 updated to the superseded state.
- WO1 script: 17 / 17 caught.

## 56. Security / Plain-Data Audit

All of the following are rejected with diagnostics:

- getters, functions, cycles and unsafe keys;
- non-finite and negative values;
- unknown or duplicate Resources;
- reservation on a non-reservation Resource;
- invalid cost structures, timing and Size values;
- unknown actions and terrains;
- forged, stale or foreign receipts.

## 57. Immutability / Serialization

- Caller state is never mutated.
- Plans and readings are deep-frozen and survive a JSON round-trip without loss.
- Equal requests give deep-equal plans and runs.

## 58. Historical Reproducibility

Run on the real database:

1. Release R1 is evaluated (Heavy 3 AP, mana and refresh).
2. R2 changes the Heavy Attack cost to 4.
3. R1 is re-materialized and re-evaluated. Its plan and run are identical to the first R1 evaluation.

## 59. Ruleset Isolation

R1 and R2 materialize concurrently and give listed costs 3 and 5. Each cites only its own EntityVersion. A mixed
bundle and context is refused.

## 60. M4 Regression

- `@prowess/rules`: 659 unit tests green; source tree byte-identical.
- The M4 gates are inside the unit and integration suites that ran.

## 61. M5-WO1 Regression

- WO1 static audit and 17 controls are green.
- The catalog regex now admits `m5-wo3-negative-controls.mjs`.
- The catalog count is now 110.

## 62. M5-WO2 Regression

WO2 goldens, contracts and static audit are green. Values are unchanged. Only the two explicitly superseded behaviours
were updated:

- Movement deferral
- ROLL_MODE_CONFLICT

## 63. Documentation

- `docs/architecture/m5-runtime-resources-action-economy.md` (31 sections and the 6 required diagrams).
- Updated: the register, invariants, `ci.md` and this report.

## 64. Local Verification

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | ✅ |
| lint | ✅ |
| architecture checks | ✅ |
| typecheck | ✅ |
| unit tests (all packages, 3,975 tests, including Studio 2,327) | ✅ |
| production build | ✅ |
| Playwright | ✅ 45 / 45 |
| API integration | ✅ 113 / 113, including WO2 and WO3 |
| DB integration | 501 / 511 ✅ — the 10 failures are environmental (§65) |
| WO1 / WO2 / WO3 negative controls | ✅ |
| non-test reset refusal | ✅ |

The DB integration run includes both history suites (WO2 and WO3), which pass.

## 65. Environment Limitations

The sandbox proxy blocks `binaries.prisma.sh` (403), so the Prisma schema engine cannot be downloaded. As a result:

- `prisma validate`, `prisma generate` and `migrate deploy` could not run.
- The guarded `db:reset:test` reset could not run.
- The drift check could not run.

The test database was built by applying the committed migration SQL with `psql`. Because of that, no
`_prisma_migrations` ledger exists. The 10 DB tests that inspect that ledger ("migration is applied and finished",
M1 / M2 / M3 ledger checks) fail locally for that reason only. They touch no WO3 code.

GitHub CI uses the real Prisma engine.

## 66. GitHub Verification Needed

On the PR, then on merged `main`, CI must confirm:

- Prisma drift = No differences
- the full DB integration suite, including the ledger checks
- all M0–M4, M5-WO1 and M5-WO2 gates
- the new M5-WO3 gate
- production build
- Playwright

## 67. Acceptance Criteria Status

Every §218 criterion is met locally except the CI-only items:

- Prisma drift zero
- guarded reset
- merged-main GitHub CI

Those three are pending CI. One open designer question is flagged rather than resolved: M5-SC-034 (Sprint basis).
