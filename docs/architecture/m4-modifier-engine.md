# M4 Modifier Engine (M4-WO6)

**Status:** M4-WO6 — Modifier Engine. Invariants M4-I65 – M4-I79 are catalogued, with their automated guards, in
`m4-rules-engine-core.md`.

## Purpose

The Modifier Engine answers one question: **"Given an explicit starting value and an explicit ordered set of
modifiers, what is the result?"**

Modifiers transform explicit values; they never decide what a value means. The engine has no idea whether a target
is a Spell's MP, a weapon's damage or anything else.

Code: `packages/prowess-rules/src/modifier/` (`model.ts`, `validate.ts`, `evaluate.ts`). It is pure, inside
`@prowess/rules`, which still depends only on `@prowess/model`. There is no database access, persistence, route, UI
or new dependency.

```
WO3 Formula Engine
       │
       ▼
Explicit Base Values
       │
       ├──────────────┐
       ▼              ▼
Modifier Definitions  WO5 Requirement Facts
       │              │
       └──────┬───────┘
              ▼
       Modifier Engine
              │
              ▼
     Modified Value / State
              │
              ▼
Future: Resource / Spell / Weapon / Character / Validation systems
```

## API

```ts
evaluateModifiers({ targets, modifiers, facts? }, { ruleset? }): RuleEngineResponse<ModifierEvaluationResult>
validateModifiers({ targets, modifiers, facts? }): ModifierValidation        // structure only
```

`facts` is the M4-WO5 `RequirementFacts` input and is needed only by conditions. A supplied RulesetContext is
recorded as response provenance and never searched: modifiers are never discovered from contexts, Keywords or the
Ruleset, only supplied.

## Targets

Every modifier names one **exact target key**, which follows the M4-WO1 context-key grammar: exact, case-sensitive,
locale-free. Targets must be supplied by the caller. A modifier on a missing target fails closed with `INVALID_TARGET`;
not even `SET` creates one.

| Family | Shape | Used by |
| --- | --- | --- |
| `NUMERIC` | `{ targetKey, kind, value }` (finite) | ADD, SUBTRACT, MULTIPLY, DIVIDE, SET, MIN, MAX, INCREASE_PERCENT, REDUCE_PERCENT |
| `ORDERED` | `{ targetKey, kind, currentKey, steps[], boundaryPolicy }` | STEP_UP, STEP_DOWN |
| `ROLL_SIGNAL` | `{ targetKey, kind }` | ADVANTAGE, DISADVANTAGE |

Using an operation on the wrong family (ADD on ORDERED, STEP_UP on NUMERIC, ADVANTAGE on NUMERIC) is
`TARGET_TYPE_MISMATCH`.

## Operations (the complete PAS-02 RuleModifier vocabulary)

| Operation | Operand | Result |
| --- | --- | --- |
| `ADD` | finite x | `current + x` |
| `SUBTRACT` | finite x | `current − x` |
| `MULTIPLY` | finite x | `current × x` |
| `DIVIDE` | finite x ≠ 0 | `current ÷ x` (x = 0 → `DIVISION_BY_ZERO`) |
| `SET` | finite x | `x` |
| `MIN` | finite x | `Math.min(current, x)`: selects the lower value; not a "floor" |
| `MAX` | finite x | `Math.max(current, x)`: selects the higher value; not a "cap" |
| `INCREASE_PERCENT` | finite p ≥ 0 | `current × (1 + p/100)` |
| `REDUCE_PERCENT` | finite p ≥ 0 | `current × (1 − p/100)` (p > 100 allowed: the result may go negative) |
| `STEP_UP` / `STEP_DOWN` | integer ≥ 1 | move along the ladder |
| `ADVANTAGE` / `DISADVANTAGE` | none (an operand is rejected) | record a signal |

No operation is dropped and none is added. There is no CUSTOM, no callback and no game-specific operation such as
`AFFINITY_DISCOUNT` or `MANA_EFFICIENCY`.

### Numeric semantics

- Each operation is exactly its formula, applied to the running value. **Nothing rounds**: 17 reduced by 10% is 15.3,
  not 15. Any rounding is an explicit Formula or content rule elsewhere.
- **Percentages apply sequentially:** 100 − 10% − 10% = 81, never 80. Two modifiers are never pre-combined into one
  percentage. If content means "20%", it supplies one modifier of 20.
- Every result must be finite. NaN or ±Infinity anywhere fails closed with `NON_FINITE_RESULT`. `-0` is normalized to
  `0`. There is no clamp at zero.

### Ordered steps

The ladder is caller data: `["A", "B", "C", "D"]` in tests, a Player Dice ladder (d4 → d6 → d8 → d10 → d12) supplied
by a future subsystem. The engine contains no ladder. Step keys are unique exact labels, and `currentKey` must be one
of them. Each ORDERED target carries an explicit **boundary policy**, and there is no default:

- `CLAMP`: stepping past an end stays at that end;
- `INVALID`: stepping past an end fails closed with `STEP_OUT_OF_RANGE`.

For example, B, then STEP_UP 1, then STEP_DOWN 2 gives A.

### Advantage / Disadvantage: signals, not roll semantics

Signals are collected on a ROLL_SIGNAL target, in application order:

```
{ targetKey, kind: "ROLL_SIGNAL", advantage: ["adv1", "adv2"], disadvantage: ["dis1"] }
```

The engine records which signals apply and counts them. It does **not** decide how many dice are rolled, whether
signals stack, whether Advantage and Disadvantage cancel, or which die is kept. No net value is computed, and nothing
is ever rolled. That belongs to a future roll-resolution rule.

## Phases, priority and order

Every modifier has an explicit phase `{ phaseKey, phaseOrder }`, an integer `priority` and an integer `order`.
Application order is exactly:

```
phaseOrder ASC → priority ASC → order ASC → modifierKey ASC (UTF-16 code units)
```

Input array order never matters. Operations do not commute: ADD 5 then MULTIPLY 2 gives 30, while MULTIPLY 2 then
ADD 5 gives 25. The explicit fields decide which applies first. Phases are caller-defined data: names like "Base",
"Affinity" or "Final Cost" carry no behaviour. One `phaseKey` given two different `phaseOrder`s is a
`PHASE_CONFLICT`. `modifierKey` is unique evaluation identity: an identical duplicate collapses, and a conflicting one
is `DUPLICATE_KEY`.

```
Base Value
    │
    ▼
Phase 10
  Modifier A      before → operation → after
  Modifier B      before → operation → after
    │
    ▼
Phase 20
  Modifier C      before → operation → after
    │
    ▼
Phase 30
  Modifier D      before → operation → after
    │
    ▼
Final Value
```

Generic example: base 100 → (phase 10) ADD 20 → 120 → (phase 20) REDUCE_PERCENT 25 → 90 → (phase 30) MAX 50 → 90.

## Conditions (M4-WO5)

A modifier may carry an optional M4-WO5 Requirement as its condition. Conditions are validated by WO5's
`validateRequirement` and evaluated through WO5 against facts **prepared once** per evaluation; there is no second
predicate evaluator. **Every** condition is evaluated, so invalid conditions are all reported, never hidden behind an
earlier one.

```
Modifier
   │
   ├── Requirement satisfied
   │       ↓
   │     APPLY
   │
   ├── Requirement false
   │       ↓
   │     SKIP
   │
   └── Requirement invalid
           ↓
       INVALID EVALUATION
```

A false condition produces a `SKIPPED_CONDITION` outcome with the value unchanged and no error, warning or info.
There is no "condition not met" code. An invalid condition reports `MODIFIER.INVALID_CONDITION` and keeps the
underlying `REQUIREMENT.*` code in `details.requirementCode`.

## Stacking

```
STACK
A ─┐
B ─┼──► apply all in explicit order
C ─┘

UNIQUE(group-X)
A ─┐
B ─┘
different definitions
     ↓
STACKING_CONFLICT

No hidden strongest-wins rule.
```

- **STACK** is the default. Every applicable modifier applies, in order. Several SETs are allowed: the later one by the
  sort tuple wins, because the order is explicit.
- **UNIQUE** requires a `stackingKey`. Among *applicable* modifiers, at most one distinct definition may hold a key.
  Identical definitions (everything but `modifierKey`) collapse: the first in order applies and the others are
  `DEDUPLICATED` with `deduplicatedBy`. Different definitions are a `STACKING_CONFLICT`. The engine never picks the
  higher amount, the later modifier, the higher priority, the newer source or a Canon source. A modifier skipped by its
  condition does not occupy a UNIQUE key.
- `stackingKey` is exact identity with no meaning parsed from its text.

## Result, outcomes, provenance, trace

```
ModifierEvaluationResult { initialTargets, finalTargets, outcomes }
ModifierOutcome {
  modifierKey, targetKey, operation, operand, phase, priority, order,
  status (APPLIED | SKIPPED_CONDITION | DEDUPLICATED), before, after,
  condition ({ satisfied } | null), deduplicatedBy, stacking, source, provenance
}
```

- Outcomes are listed in actual application order, so each one shows which modifier it was, where it came from
  (`source` `{sourceType, sourceKey, sourceId}` and `provenance`), and why it applied or was skipped.
- Final ORDERED state reports `currentKey` and `position`; the ladder itself appears once, on the initial target.
- The trace is **target → phase → modifier**, in exact application order. Each target step records its key, initial
  value and final value. Each modifier step records its key, status, before value, operand and after value, and
  carries the modifier's provenance. A conditional modifier's step has the WO5 Requirement trace as its child, with
  the condition's own provenance kept distinct from the modifier's.
- No prose is produced; explanation is M4-WO9.

## Diagnostics

| Code | Meaning |
| --- | --- |
| `MODIFIER.INVALID_DEFINITION` | malformed modifier / request: unknown field, bad operation, phase, priority, order, stacking, source |
| `MODIFIER.INVALID_TARGET` | malformed target or ladder, or a modifier naming a target that was not supplied |
| `MODIFIER.TARGET_TYPE_MISMATCH` | operation used on the wrong target family |
| `MODIFIER.INVALID_OPERAND` | missing, non-finite, negative-percentage or non-integer-step operand; an operand on a signal |
| `MODIFIER.DIVISION_BY_ZERO` | DIVIDE by 0 |
| `MODIFIER.NON_FINITE_RESULT` | an operation overflowed |
| `MODIFIER.PHASE_CONFLICT` | one phaseKey with two phaseOrders |
| `MODIFIER.DUPLICATE_KEY` | conflicting modifiers sharing a modifierKey, or a targetKey supplied twice |
| `MODIFIER.STACKING_CONFLICT` | different applicable modifiers sharing a UNIQUE stackingKey |
| `MODIFIER.STEP_OUT_OF_RANGE` | a step past the ladder under the INVALID boundary policy |
| `MODIFIER.INVALID_CONDITION` | a condition (or the facts it needs) cannot be evaluated |
| `MODIFIER.LIMIT_EXCEEDED` | targets, modifiers or ladder steps over the limits |

These are VALIDATION messages: categories REQUIREMENT (conditions), PARAMETER (operands and numeric or step
failures) and STRUCTURE (everything else). Any of them makes the evaluation INVALID with `data: null`. Malformed
data never becomes an ordinary skipped modifier. Diagnostics are deterministic: input order for structure, sorted
key order for grouped conflicts, application order for evaluation failures. Paths are RFC 6901 pointers into the
request (`/modifiers/3/operand`).

## Safety, determinism, immutability

- **Limits:** 2,048 targets, 10,000 modifiers and 2,048 ladder steps per target. Condition trees keep M4-WO5's own
  limits.
- Input is strict plain data: own data properties only. Getters are never invoked, functions are never called, and
  unknown fields are rejected.
- Targets and conditions use internal indexes built once, so there are no repeated full scans. No Map or Set is
  public.
- The same request in any array order produces a byte-identical response.
- Nothing is mutated. In particular, the caller's facts object is never frozen or changed. Outputs are deep-frozen,
  detached and JSON-serializable, and later changes to caller objects cannot alter a returned result. Only the exact
  supplied content is used, so later Ruleset or Entity changes elsewhere cannot affect a repeated evaluation.

## Listed cost vs runtime payment (M4-I14, M4-I79)

The Modifier Engine may compute a **listed** value. Runtime **payment** is a different act and is never modelled
here: no payment, reservation, Mana Lock, ME spending, AP refresh or Sustain.

```
Listed Value Pipeline
       │
       ▼
Final Listed Cost = 17
       │
       ├──► other formulas may use 17
       │
       ▼
Future Resource Engine
       │
       ├── ME payment 6
       └── MP payment 11

Listed cost remains 17.
```

A future rule where ME changes *which resource pays* is not a modifier to the listed MP cost. Listed MP stays 17, and
the listed AP is calculated from 17. The payment split belongs to M4-WO7 and later.

## Future compositions (illustrative, not implemented)

- **Spell cost:** base cost → explicit Affinity modifier → explicit Casting Condition modifier → final listed cost.
  The engine knows nothing about Affinity or Casting Conditions.
- **Weapon:** base damage → ADD bonus → MULTIPLY feature → MIN / MAX cap.
- **Player Dice:** a d4 → d12 ladder supplied by a subsystem; STEP_UP / STEP_DOWN operate on it generically.

## Handoff

- **WO7 Resource Engine:** consumes modified numeric values. It owns current and maximum values, temporary pools,
  reserved capacity, payment, refresh and locks.
- **WO8 Validation Engine:** composes Modifier diagnostics with Formula, Requirement, Resource and compatibility
  diagnostics. WO6 validation stays local.
- **WO9 Explanation:** composes Formula, Requirement and Modifier traces. WO6 keeps the structured before / after
  values and provenance it needs.

## Limitations

M4-WO6 does not implement: persistent ModifierDefinitions; Modifier authoring UI; game-specific modifier discovery;
Spell cost, Affinity, Casting Condition, Weapon or Character rules; resource payment or locking; Mana Efficiency; Mana
Lock; Sustain; dice rolling; Advantage / Disadvantage roll resolution; cross-system validation; the explanation engine;
HTTP APIs; Studio UI. No schema change, no migration.
