# M5 — Runtime Resources, Action Economy, Movement & Roll-State Resolution (M5-WO3)

M5-WO3 turns the WO2 static capacities into runtime Resource state and adds the action economy, Base Movement,
Initiative and roll-signal resolution. Everything runs on the frozen M4 engine. `@prowess/game` chooses which
authored operation runs and wires its inputs. M4 performs every spend, restore, refresh, reservation, release, payment
allocation, Formula and Requirement. Nothing is persisted.

- Content: `packages/prowess-game/src/content/core-playtest-v0.1/runtime-resources.json` (6 RESOURCE, 13 ACTION,
  5 CREATURE_SIZE, 2 TERRAIN Definitions). `core-resolution.json` gains `BASE_MOVEMENT`, `FINAL_MOVEMENT` and the
  `INITIATIVE` procedure.
- Code: `packages/prowess-game/src/runtime/` (`compile.ts`, `definitions.ts`, `resources.ts`, `results.ts`,
  `combat.ts`), `definition/runtime-payload.ts`, `vocabulary/runtime.ts`, `core/dice.ts` (`resolveRollSignals`).
- Invariants: M5-I075–M5-I110 (`m5-invariants.md`). M5-I073 is SUPERSEDED by M5-I075.
- Permanent gate: **M5-WO3 audit — Runtime resources, action economy & movement** (`docs/architecture/ci.md`).

## 1. Scope

In scope: runtime HP, MP, ME, AP and Counter Action; the movement-allowance tracker; keeping maximum and current
separate; AP refresh and expiry; Counter Action refresh and the no-banking rule; ME refresh; ME → MP payment for
explicitly eligible magical costs; common Action definitions and AP costs; Base Movement; the Movement pipeline
contract; Creature Size as a tactical identity; the round / side / turn timing contract; Initiative and its
tie-break; Surprise and Counter Actions; the shared player phase; Advantage / Disadvantage cancellation.

Out of scope: Spell construction, Affinity, damage resolution, Death & Dying, status Conditions, Sustain,
Concentration, the Mana Lock policy, weapon damage, movesets and channeling.

## 2. Source Authority

The precedence is unchanged:

1. Explicit designer rulings (M5-WO3 §4–§15).
2. Approved CanonDecisions.
3. Core Playtest Packet V0.1.
4. Older material.

Every locator was re-read from the verified Core Playtest bytes (SHA-256 prefix `21fa6771`), parsed with
`prowess-docx-structure@1.0.0`. It has 2,487 sections, the same structure as M3-WO9. The main locators are:

- s43–s46 Action Points
- s47–s48 and s434–s435 Counter Actions
- s49–s55 Combat Round, Surprise, Initiative and the Shared Player Turn
- s69–s71 Movement and Sprint
- s101–s111 core statistics
- s423–s440 Combat Order, the Player Turn, Common Action Costs, Move, Splitting Movement, Sprint and Difficult /
  Hazardous Terrain
- s441–s442 Creature Space
- s643–s649 Mana, Mana Efficiency and Mana Lock

## 3. M5-SC-006 Resolution

M5-SC-006 is `RESOLVED_BY_DESIGNER` under M5-WO3 §4. Base Movement = 5 ft × AGI, stored as
`core.derived.base_movement` with expression `5 * agi`, unit ft and rounding NONE (s23, s69, s70, s104, s436). The
contradictory 10 × AGI character example (s156) is superseded for structured mechanics. The source text is unchanged.

WO2 history stays as it was: WO2 correctly deferred Movement as `DEFERRED_PENDING_CANON` (M5-I073). M5-I073 is now
recorded as SUPERSEDED by M5-I075. It is kept, not deleted. `DEFERRED_STATISTICS` is empty.

Golden results:

| AGI | Base Movement |
| --- | --- |
| 1 | 5 ft |
| 2 | 10 ft |
| 4 | 20 ft |
| 6 | 30 ft |
| 10 | 50 ft |

## 4. M5-SC-032 Resolution

M5-SC-032 is `RESOLVED_BY_DESIGNER` under M5-WO3 §8–§12. Advantage and Disadvantage are presence-based signals and
never stack. WO2 failed closed when both were present (`PROWESS_CORE.ROLL_MODE_CONFLICT`); that was correct while the
question was unresolved. WO3 removes that behaviour narrowly in `@prowess/game`. M4 Modifier semantics are unchanged:
M4 still only collects the symbolic signals.

## 5. M5-SC-033 Pending Size Movement Values

M5-SC-033 is `UNRESOLVED`. Movement may depend on Size, but no values exist. The unknowns are:

- the adjustment for each Size;
- whether it is additive or multiplicative;
- whether Small and Medium share one;
- whether Massive has a fixed rule.

`CREATURE_SIZE.movementAdjustment` must be null. Any other value is refused as
`PROWESS_DEFINITION.DEFERRED_PENDING_CANON`.

## 6. Resource Model

| Resource | Definition | M4 kind | Maximum | Refresh | Expiry | Spending |
| --- | --- | --- | --- | --- | --- | --- |
| HP | `resource.hp` | POOL | MAXIMUM_HP | — | — | direct; restore ≤ nominal max, CLAMP |
| MP | `resource.mp` | POOL | MAXIMUM_MP | — | — | direct; restore ≤ available max; reservation |
| ME | `resource.me` | TEMPORARY_POOL | BASE_MANA_EFFICIENCY | START_OF_ROUND → max | — | direct; no restore |
| AP | `resource.ap` | ACTION | BASE_AP_CAPACITY | START_OF_TURN → max | END_OF_TURN → 0 (preservable) | direct; no restore |
| Counter Action | `resource.counter_action` | SLOT | COUNTER_ACTION_CAPACITY | START_OF_ROUND → max | — | payment only (Surprise) |
| Movement allowance | `resource.movement_allowance` | TRACKER | unbounded | — | END_OF_TURN → 0 (preservable) | direct; grant = restore |

A RESOURCE Definition holds:

- resourceKey
- m4Kind
- minimum
- maximum source
- refresh and expiry rules
- spending mode
- restoration
- reservation support
- payment eligibility
- usage restrictions
- depletion exposure
- source

It never holds a current value (M5-I080, M5-I081).

```
Derived Capacity
      │
      ▼
Runtime Resource State
 ┌─────────┬────────┬────────┬────────┬─────────────┐
 ▼         ▼        ▼        ▼        ▼
HP        MP       ME       AP      Counter Action

M4 Resource Engine
      │
      ▼
new immutable runtime state
```

Runtime state (`ProwessRuntimeResources`) is caller input. It contains `{ resourceKey, current, reservedCapacity }`
for each Resource. The maximum is never supplied. It is the WO2 capacity statistic, evaluated by M4 inside every
runtime plan and bound into the first snapshot. If current exceeds maximum, M4 reports `RESOURCE.INVALID_STATE`; no
TypeScript clamp exists.

## 7. HP

- Maximum HP = Base HP + CON + bonuses (WO2).
- 0 ≤ current ≤ maximum.
- No refresh or expiry at any timing (M5-I082).
- An already-resolved spend is an M4 SPEND; an amount above current is `applied: false` with a shortfall.
- Overkill damage, Armor, Resistance and Damage Threshold are later work.
- Healing is an explicit RESTORE up to the nominal maximum with CLAMP. WO3 does not calculate healing effects.
- Every plan that carries HP exposes a `depletion` Requirement (HP == 0). Downed, Death Saves and Lethal / Non-Lethal
  outcomes are deferred (M5-I107).

## 8. MP

- Maximum MP = Base MP + RES + bonuses.
- MP never refreshes on a turn or round (M5-I083).
- MP pays MAGICAL_COST at order 0 and ME_ELIGIBLE_MAGICAL_COST at order 1.
- MP is the only Resource that supports reserved capacity.
- Restoration is bounded by the available maximum.

## 9. ME

- ME Maximum = PRO (`BASE_MANA_EFFICIENCY`).
- ME refreshes to its maximum at START_OF_ROUND and never accumulates above it (M5-I089).
- ME and MP are separate Resources. Nothing stores "MP + ME".
- Golden: PRO 5, ME 1 → start of Round → 5.

## 10. AP

- AP Capacity = 3 + floor(AGI / 3) (WO2).
- AP refreshes to Capacity at START_OF_TURN (M5-I084) and is set to 0 at END_OF_TURN (M5-I085), unless an explicit
  rule supplied in `preserve` keeps it.
- AP is one spendable pool, not action slots (M5-I096). Insufficient AP is `canPay: false` with a shortfall — a valid
  result, not an error.
- Golden results:
  - AGI 6 (Capacity 5): AP 1 → start of turn → 5.
  - Balanced Attack: 5 → 3.
  - Heavy Attack with 2 AP: `canPay: false`, shortfall 1, AP stays 2.
  - End of turn: 2 → 0.

## 11. Counter Action

- Capacity = 1 (`COUNTER_ACTION_CAPACITY`, content). It refreshes to Capacity at START_OF_ROUND.
- Refresh never raises it above Capacity, and it has no generic restoration, so it never banks (M5-I086, M5-I087).
- A capacity increase must come from an explicit, source-defined change to the capacity content in a later Release.
- A Counter Action reaction (`action.counter_reaction`):
  - is taken OUTSIDE_OWN_TURN;
  - needs an explicit trigger;
  - pays COUNTER_ACTION_COST 1;
  - spends no AP (M5-I088).
- Having a Counter Action does not authorise a reaction.

## 12. Resource Refresh Timing

```
START ROUND
├─ ME → Maximum
└─ Counter Action → Capacity

START CREATURE TURN
└─ AP → Capacity

END CREATURE TURN
├─ unused AP expires
└─ movement allowance expires

HP / MP
└─ no automatic combat refresh
```

`RESOURCE_TIMING` compiles every supplied Resource's authored rule at one event:

- **Refresh** is an M4 REFRESH to the maximum.
- **Expiry** is an M4 SET_CURRENT to the Definition's minimum.

END_OF_ROUND has no Resource behaviour in content. It exists as a timing identifier for later subsystems. AP does not
refresh at START_OF_ROUND.

## 13. Payment Ordering

```
Listed Magical Cost
        │
        ▼
Payment Allocation
   ├─ ME first
   └─ MP second
        │
        ▼
Runtime State

NO ARROW BACK TO LISTED COST
```

`MAGICAL_PAYMENT` requires an explicit `meEligible`:

- **true** uses the ME_ELIGIBLE_MAGICAL_COST policy: ME at order 0, then MP at order 1.
- **false** uses MAGICAL_COST: MP only (M5-I090).

The listed amount is an M4 payment literal, echoed unchanged. Nothing binds into it (M5-I091). Payment is M4's single
allocation algorithm. If the cost cannot be paid, `canPay: false` and the state is unchanged (M5-I092).

| Case | Listed | Before | Paid | After |
| --- | --- | --- | --- | --- |
| Can pay | 8 | ME 5, MP 18 | ME 5, MP 3 | ME 0, MP 15 |
| Cannot pay | 10 | ME 3, MP 4 | nothing (shortfall 3) | ME 3, MP 4 |

## 14. Reservation Boundary

MP supports M4 `reservedCapacity`. Reserving changes capacity only (M5-I093). Releasing restores capacity but never
refills current MP (M5-I094).

| Case | Before | Operation | After |
| --- | --- | --- | --- |
| Reserve | maximum 20, current 18 | reserve 6 | reserved 6, available maximum 14, current 18 |
| Release | current 9, reserved 6 | release 6 | available maximum 20, current 9 |

When a spell reserves MP, how much it reserves and when it releases it are Sustain / Mana Lock work (M5-WO13). No
Mana Lock compiler exists in WO3.

## 15. Action Definitions

An ACTION Definition holds:

- actionKey
- timing (OWN_TURN | OUTSIDE_OWN_TURN)
- `actionPointCost`: FIXED / RANGE / MINIMUM / VARIABLE / NONE
- `otherCosts`: payment policy + amount
- `movementGrant`: an M4 Formula over DERIVED statistics only
- `requiresTrigger`
- `costOverridableByExplicitRule`
- rules
- source

No action-name switch exists (M5-I097). The AP listed amount comes from content:

- **FIXED** — the content amount, or an explicit `costOverride` that names its source rule (§59).
- **RANGE / MINIMUM** — the explicitly chosen cost, checked against the authored bounds.
- **VARIABLE** — the cost the owning system determined, plus its `costSourceKey`.

Actions use two-phase safety (§76):

1. `ACTION_PAYMENT` compiles the usage-availability Requirements and the payments (PREVIEW + APPLY).
2. `confirmActionPayment` reads the M4 run and returns PAID, CANNOT_PAY or UNAVAILABLE. Only PAID carries the
   resulting state. Any other result returns the original state, so there is no partial payment (M5-I110).
3. `ACTION_FOLLOW_ON` compiles the secondary benefit (a Move or Sprint allowance) only from a PAID receipt, on exactly
   that state. M4 never blocks a later step because `canPay` is false, so the benefit lives in a separate plan.

## 16. Common Action Costs

| Action | Key | AP |
| --- | --- | --- |
| Move | `action.move` | 1 |
| Sprint | `action.sprint` | 3 |
| Light Attack | `action.attack.light` | 1 |
| Balanced Attack | `action.attack.balanced` | 2 |
| Heavy Attack | `action.attack.heavy` | 3 |
| Block | `action.block` | 2 |
| Dodge Action | `action.dodge` (`DODGE_ACTION`) | 3 |
| Reload | `action.reload` | 1 unless stated otherwise |
| Interact | `action.interact` | MINIMUM 1 |
| Grapple | `action.grapple` | RANGE 1–2 |
| Cast Spell | `action.cast_spell` | VARIABLE (SPELL) |
| Use Skill Action | `action.use_skill` | VARIABLE (SKILL_ACTION) |
| Counter reaction | `action.counter_reaction` | NONE (1 Counter Action) |

Sources are s44 and s432. M5-SC-026 (weapon attack AP) and M5-SC-027 (reload) stay UNRESOLVED; these are the core
defaults. The Dodge Action (`action.dodge`, an ACTION) and the Dodge defense (`core.derived.dodge`, a DERIVED_STAT) are
distinct identities. WO3 implements no weapon damage, Power, movesets or properties.

## 17. Base Movement

```
AGI
 │
 ▼
5 × AGI
 │
 ▼
Base Movement
 │
 ├─ Size Adjustment       ← values pending canon
 ├─ Other Modifiers
 │
 ▼
Final Movement
 │
 ▼
Move / Sprint Allowance
```

- `BASE_MOVEMENT = 5 * agi`.
- `FINAL_MOVEMENT = base_movement + bonuses`, where the bonuses are explicit bonuses targeting MOVEMENT.
- WO3 guarantees the first stage (M5-I075). The Size stage starts working only when M5-SC-033 has values (M5-I076).

## 18. Creature Size

| Size | Occupied space (s442) |
| --- | --- |
| SMALL | 5 ft |
| MEDIUM | 5 ft |
| LARGE | 10 ft × 10 ft |
| HUGE | 15 ft × 15 ft |
| MASSIVE | 20 ft × 20 ft or larger |

`occupiedSpaceFeet` keeps the dimensions as written. Occupied space is not speed (M5-I108). WO3 has no map,
coordinates, pathfinding or collision.

## 19. Movement Allowance

A Move or Sprint grants allowance on the `resource.movement_allowance` tracker by M4 RESTORE. The grant is the
action's Formula over Final Movement. The Movement statistic itself never changes (M5-I098). The allowance is runtime
state, is never persisted and expires at END_OF_TURN.

Golden: AP 3, Move → AP 2 and allowance +20 ft (AGI 4).

## 20. Split Movement

A `MOVEMENT` subject spends allowance one segment at a time, as an M4 SPEND per segment. Other actions may happen in
between. No second Move cost exists (M5-I099).

Golden: allowance 20 → move 10 → attack → move 10 → 0.

Moving past the remaining allowance is `applied: false` with a shortfall; nothing is taken.

## 21. Difficult Terrain

| Terrain | Allowance cost |
| --- | --- |
| `terrain.normal` | `distance` |
| `terrain.difficult` | `distance * 2` (s439) |

Golden: 5 ft of Difficult Terrain consumes 10 ft, so 20 → 10 (M5-I100). Map detection of terrain is not implemented.
Hazardous Terrain effects (s440) are later Effect / Condition work.

## 22. Sprint

- Sprint costs 3 AP. Its grant is `final_movement * 4`, as M5-WO3 §73 states (s438, "quadruple Total Movement").
- Each Sprint is a separate execution with its own grant output. The grant always reads Final Movement and never the
  accumulated allowance, so repeated Sprint is linear and never ×4 ×4 (M5-I109).
- Golden: AGI 9, two Sprints → 180 + 180 = 360 ft.
- The source differs on whether Sprint quadruples Base Movement (s71, s228) or Total Movement (s438, s485), and does
  not say how repeated Sprints combine. This is recorded as M5-SC-034 (UNRESOLVED; designer confirmation requested).
  The readings differ only when an explicit Movement modifier exists.

## 23. Combat Round

The sequence is `COMBAT_ROUND_SEQUENCE` (s50, s423):

1. DETERMINE_SURPRISE
2. ROLL_INITIATIVE
3. FIRST_SIDE_ACTS
4. NEXT_SIDE_ACTS
5. END_OF_ROUND
6. REFRESH_AND_REPEAT

The timing events are START_OF_ROUND, START_OF_TURN (a creature's acting window inside its side phase), END_OF_TURN
and END_OF_ROUND. WO3 provides these identifiers. Effect ticking and clocks belong to later subsystems.

```
Initiative
    │
    ▼
Winning Side
    │
    ├─ Side Phase
    │    ├─ Creature/player order chosen within allowed rules
    │    └─ Counter reactions from opposing side
    │
    ▼
Next Side
    │
    ▼
End Round
    │
    ▼
Refresh
```

## 24. Initiative

Each side's one chosen creature rolls the procedure `core.resolution.initiative`, compiled by the WO2 core compiler as
FORMULA steps only:

- natural: `r1`, `max(r1, r2)` or `min(r1, r2)`
- total: `natural + per / 2 + agi / 2 + bonuses`, rounding NONE

Fractional totals are valid (M5-I102). The die result is runtime input; nothing is rolled.

`resolveInitiativeOrder` compares the M4 totals. On a tie it compares the highest Stat among each tied side's
creatures, in the order the Definition's `tiebreak` lists them: PER, then AGI, then REROLL. A full tie returns
`REROLL_REQUIRED` and the reroll is new runtime input (M5-I103).

| Case | Inputs | Result |
| --- | --- | --- |
| Total | d8 5 + 2.5 + 1.5 + 1 | 10 |
| Tie on total | highest PER 5 vs 4 | side A first |
| Tie on PER and AGI | — | REROLL_REQUIRED |

## 25. Shared Player Phase

`createSidePhase` holds a side's creatures as a set:

- `orderPolicy: CHOSEN_BY_SIDE`
- `actingOrder: null`
- never sorted by Initiative, PER, AGI, name or storage order (M5-I101)

`validateActingSequence` accepts any sequence:

- C → A → B is allowed.
- A creature may wait.
- Interleaving (a creature acting again after another acted) needs `interleavingApproved` (GM approval, s54, s429).

## 26. Surprise

`resource.counter_action` carries the usage restriction `SURPRISED` with `throughRound 1`. A REQUIREMENT expresses it
as `NONE(ALL(combat.surprised == 1, combat.round <= 1))`.

In round 1, a surprised creature's Counter Action still refreshes to Capacity 1; nothing is spent or removed. It is
UNAVAILABLE: confirmation returns UNAVAILABLE and the original state. In round 2 it is available.

Surprise may also limit actions at GM discretion; WO3 invents no AP penalty for this (M5-I104).

## 27. Roll-State Resolution

```
Advantage Sources ─┐
                   │
                   ├─ presence resolution ─► Roll Mode
                   │
Disadvantage Sources┘

A only → ADVANTAGE
D only → DISADVANTAGE
A + D  → NORMAL
neither → NORMAL

Counts never strengthen or net.
```

`resolveRollSignals` returns:

- `mode`
- every Advantage source and every Disadvantage source, sorted and all kept
- `cancelled`
- `ruling: M5-SC-032`

`resolveRollMode` (the WO2 API) returns its mode. Example: 2 Advantage + 1 Disadvantage → NORMAL, not "net Advantage"
(M5-I077–I079). Stat Mastery + High Ground vs Poisoned → NORMAL, with all three sources visible.

## 28. M4 Compilation

`compileRuntime` subjects and their fragment families:

| Subject | Fragment family |
| --- | --- |
| RESOURCE_STATE | RESOURCE_INITIALIZATION |
| RESOURCE_TIMING | ROUND_REFRESH / TURN_REFRESH |
| RESOURCE_TRANSITIONS | RESOURCE_TRANSITION |
| MAGICAL_PAYMENT | MAGICAL_PAYMENT |
| ACTION_PAYMENT | ACTION_PAYMENT |
| ACTION_FOLLOW_ON | MOVEMENT_ALLOWANCE |
| MOVEMENT | MOVEMENT_ALLOWANCE |

MOVEMENT_BASE and INITIATIVE go through `compileCoreResolution`.

A runtime plan is a chain:

- The first link's snapshot binds each involved Resource's current value from `RuntimeContext.resourceValues`,
  reserved capacity from `RuntimeContext.reservedCapacity`, and maximum from the WO2 capacity FORMULA step.
- Each later link binds `/snapshot` from the previous link's `/data/resultingResources`.
- A PREVIEW reads the chain without advancing it.

Plans contain only FORMULA, REQUIREMENT and RESOURCE_* operations (M5-I095). `@prowess/rules` is byte-identical to the
WO2 baseline. The only arithmetic in the compiler is plan layout (`internal/order.ts`), never a game value.

## 29. Provenance

Every compiled step has one source-map entry citing the exact Definitions it uses: its RESOURCE, ACTION and TERRAIN
Definitions, and the WO2 derived statistic it binds. M4's own rule provenance on payment sources, transitions and
Requirements names the exact EntityVersion under the exact Ruleset / Manifest (M5-I106). M4 Explanation over a payment
response shows the listed amount, current before, paid and current after for each source. No Prowess arithmetic runs
in the browser.

## 30. Runtime/Persistence Boundary

Runtime Resources are evaluation input and output only. WO3 adds:

- no schema change
- no migration
- no EncounterState table
- no endpoint
- no evaluate-and-save, spend-and-persist, commit-turn or apply-to-character API

Evaluation through the existing `POST /api/rules/evaluate` leaves every table's fingerprint unchanged (M5-I105). Inputs
are plain data: getters, functions, cycles, unsafe keys, non-finite and negative values are refused. Outputs are
detached, deep-frozen and JSON-stable. Equal requests give deep-equal plans and runs. A Release's evaluation is
reproducible after a later Release changes an Action cost, and two Releases never mix.

## 31. Remaining Deferred Mechanics

- **M5-SC-033** — Size movement values.
- **M5-SC-034** — Sprint basis and repeated Sprint; confirmation requested.
- **M5-SC-026 / M5-SC-027** — Equipment AP and reload costs.
- **Damage pipeline** — Armor, Resistance, Damage Threshold and overkill.
- **Healing effects.**
- **Downed / Death Saves / Lethal and Non-Lethal play.**
- **Status Conditions and Hazardous Terrain effects.**
- **Mana Lock, Sustain and Concentration policy** — M5-WO13.
- **Spell AP and channeling** — multi-turn AP accumulation for Spells only.
- **Effect-driven AP refresh changes or extra Counter Actions** — a later Release changes the capacity content, or a
  later Modifier work order adds these.
- **Explicit surprise action limits** — GM policy.
- **Tactical map** — position, coordinates and pathfinding.
