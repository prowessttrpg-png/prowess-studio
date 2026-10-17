# M5-WO2 — Core Resolution, Ability Scores, Character Dice & Rank Primitives

M5-WO2 implements the first **executable** Prowess mechanics. They sit on the M5-WO1 domain architecture
(`docs/architecture/m5-prowess-domain-compilation.md`) and the frozen M4 Rules Engine. The pattern is the same for
every rule:

```
Canonical content (versioned Definitions)  →  @prowess/game compiler  →  M4 EvaluationPlan  →  M4 executes
```

`@prowess/game` chooses which authored programs run and wires their inputs. M4 does every addition, `floor`, `max`,
`min` and comparison. Nothing in TypeScript computes a Prowess number.

## 1. Scope

**In scope:**

- the six Ability Scores;
- the Character Die and its Level progression;
- the Player Dice legacy mapping;
- the shared rank ladder and Skill Rank bonuses;
- the Core Roll, Skill Check (rolled and automatic), Saving Throw and Attack Roll;
- Advantage / Disadvantage;
- Critical threat and Critical Hit;
- Character DC, Dodge and Accuracy;
- Maximum HP / MP, Strength Armor, AP capacity, Counter Action capacity, Base Range, Base Mana Efficiency and
  Signature Ability capacity;
- the Stat Mastery signal;
- deterministic roll-result handling.

**Out of scope:**

- Movement (M5-SC-006, deferred);
- runtime Resources and the Action Economy (WO3);
- the Skill catalog and per-Skill features (WO3);
- damage and critical damage (combat / equipment WOs);
- Spell / Maneuver mechanics;
- any UI, new HTTP endpoint, schema change or migration.

**Code and content:**

- Code: `packages/prowess-game/src/core/*`, `definition/core-payload.ts` and `vocabulary/core.ts`.
- Content: `packages/prowess-game/src/content/core-playtest-v0.1/core-resolution.json`, which holds 30 Definitions.

## 2. Source Authority

The M5-WO1 hierarchy is unchanged:

1. explicit designer clarifications (here: the M5-WO2 rulings);
2. approved CanonDecisions;
3. Core Playtest Packet V0.1 (SHA-256 prefix `21fa6771…`, structure hash `3d9a429c…`);
4. older supporting sources.

Source text is never rewritten. Every core Definition carries `source.locators` (`sNNN` section keys) and
`source.conflicts` (the rulings it applies), so the structured rule always points back at the prose it came from.

## 3. Designer Rulings

| Conflict | Ruling | Structured form |
| --- | --- | --- |
| M5-SC-002 | Player Die / Dice ≡ Character Die / Dice | one progression; Player Die is LEGACY terminology |
| M5-SC-003 | HP = Base HP + CON; MP = Base MP + RES | `core.derived.maximum_hp` / `maximum_mp`; multiplicative wording superseded |
| M5-SC-005 | Dodge is canonical; Evasion is legacy | one `DODGE` statistic; "+1 Evasion per 3 PER" becomes `DODGE_PERCEPTION_BONUS` |
| M5-SC-008 | Character DC = ½ CD + PRO + floor(RES/3) + bonuses | `CHARACTER_DC_RESOLVE_BONUS` is a named term |
| M5-SC-009 | Accuracy = floor(PRO/3), To-Hit | `ACCURACY` statistic, its own Attack Roll term |
| M5-SC-010 | Advantage = higher of two; Disadvantage = lower; bonuses once; no stacking | `naturalSelection` per mode |

All six are `RESOLVED_BY_DESIGNER` in `m5-core-playtest-source-conflicts.md`.

The case where Advantage and Disadvantage both apply is **not** covered by the M5-SC-010 ruling. It is recorded as
the new **M5-SC-032** (UNRESOLVED) and fails closed.

## 4. Character Die

`CHARACTER_DIE_PROGRESSION` v1 (content `core.character_die.progression`):

- `levels: [1 … 10]`;
- `dice: [{dieKey: D4, faces: 4} … {D12, 12}]`;
- `progression: [{levelMinimum, levelMaximum, dieKey}]`.

The bands are L1–2 d4 · L3–4 d6 · L5–6 d8 · L7–8 d10 · L9–10 d12.

Validation (comparisons only):

- every declared level lies in exactly one band;
- every band names a declared die;
- levels strictly increase.

`resolveCharacterDie(progression, level)` returns `{dieKey, faces, levelMinimum, levelMaximum}`, or `null` for a level
that does not exist. There is no `if (level <= 2)` anywhere (M5-I042).

A CharacterCore states its `characterDie` explicitly. A mismatch with the progression fails with
`CHARACTER_DIE_MISMATCH`; it is never repaired.

**Half Character Die** (M5-I044) is the DERIVED_STAT `HALF_CHARACTER_DIE = die_faces / 2`, evaluated by M4. It is
static (d4 2 · d6 3 · d8 4 · d10 5 · d12 6). No roll is involved.

## 5. Player Dice Legacy Mapping

The terminology inventory records:

- `Player Die` → LEGACY, canonical `Character Die`;
- `Player Dice` → LEGACY, canonical `Character Dice`.

Both carry `DESIGNER_CLARIFICATION` authority and conflict M5-SC-002. `legacyTermFor` treats spaces, hyphens and
underscores as one separator, so `PLAYER_DIE` is recognised too. A Definition payload using either term as a value
fails with `LEGACY_TERM_AS_CANONICAL`.

"1 Player Die" means one roll of the character's **current** Character Die, so a d10 character rolls 1d10 (golden
§142). There is no second progression and no Player Die size (M5-I041).

## 6. Ability Scores

The six Stats are identities owned by `@prowess/game`: `PROWESS_STATS = [STR, AGI, CON, PER, RES, PRO]`. Each has one
`STAT` v1 Definition `{stat, minimum: 1, maximum: 10, source}` (M5-I045 / M5-I046).

`@prowess/rules` never names a Stat. M4 sees only lowercase ActorContext stat keys (`str` … `pro`), mapped by the
`STAT_CONTEXT_KEYS` table.

A CharacterCore Stat outside its Definition's bounds fails with `STAT_OUT_OF_RANGE`. Values are never clamped.

## 7. Rank Model

There are two kinds of rank data, and they stay separate (M5-I047):

- **Order** — `RANK_LADDER` v1 `{ladderKey: SKILL, ranks: [{rankKey, order}]}`, with orders strictly increasing.
- **Meaning** — system-specific content. For Skills that is `SKILL_RANK` v1. Martial Rank values and Affinity
  discounts will be their own Definitions later.

There is no global `rankValue`.

Rank requirements ("requires Expert") compile to the M4 `RANK_AT_LEAST` predicate through `rankAtLeastRequirement` /
`rankFact`. The order comes from the exact ladder Definition, never from alphabetical or enum position.

```
ORDER:

Untrained
   ↓
Trained
   ↓
Expert
   ↓
Master


SYSTEM-SPECIFIC MEANING:

Skill Bonus:
0 / +2 / +4 / +6

Martial Rank Value:
defined separately

Affinity meaning:
defined separately
```

## 8. Skill Rank Bonuses

`core.skill_rank.bonuses` (M5-I048):

| Rank | Bonus | `attemptAllowed` |
| --- | --- | --- |
| UNTRAINED | 0 | false |
| TRAINED | 2 | true |
| EXPERT | 4 | true |
| MASTER | 6 | true |

UNTRAINED is a rank, not a missing Skill. It is separate from `attemptAllowed: false` (s30: an attempt is allowed only
at the GM's discretion).

A Skill Check at a rank whose `attemptAllowed` is false requires an explicit `attemptPermitted: true`. Otherwise it
fails with `ATTEMPT_REQUIRES_PERMISSION`.

A Skill the character holds no rank in is at the ladder's first rank (UNTRAINED). The bonus enters the plan as the
exact SKILL_RANK literal, cited in the source map.

## 9. Core Roll

The Core Roll is `CORE_RESOLUTION` v1 `procedure: CORE_ROLL`:

- total = `natural + stat_score + bonuses`;
- comparison `>=` against `DIFFICULTY_CLASS`.

Each part is separate (§39):

- the natural-selection FORMULA step;
- the chosen Stat binding (ActorContext);
- the named bonus-sum FORMULA (one AST variable `bonus.<key>` per bonus);
- the total FORMULA;
- the success REQUIREMENT.

```
Character Die
      +
Relevant Stat
      +
Explicit Bonuses
      │
      ▼
    Total
      │
      ▼
DC / Defense Comparison
```

## 10. Roll Inputs

Dice are runtime input (M5-I043). The input is `ProwessDieRollInput {die: {dieKey, faces}, mode, rolls[]}`.
`validateDieRollInput` accepts it only if all of these hold:

- the die is the character's Character Die;
- NORMAL has exactly 1 roll and ADVANTAGE / DISADVANTAGE exactly 2;
- every roll is a safe integer from 1 to faces.

Zero, negatives, N+1, fractions, NaN, Infinity, strings, getters and unknown fields are refused.

`buildCoreResolutionContexts` writes the validated naturals to RuntimeContext `state` keys `roll.r1` / `roll.r2`. It
also checks that the roll mode equals the compiled plan's mode. A missing roll for a rolled plan is refused.

```
External / Runtime Roll Result
             │
             ▼
        M5 Validation
             │
             ▼
      M4 Formula / Requirement
             │
             ▼
       Deterministic Result


NO RNG INSIDE ENGINE
```

## 11. Advantage / Disadvantage

Each roll procedure's content holds
`naturalSelection: {NORMAL: "r1", ADVANTAGE: "max(r1, r2)", DISADVANTAGE: "min(r1, r2)"}`. Each is an M4 FORMULA
that reads only the natural rolls (M5-I051 / M5-I052).

Bonuses enter only the total step, so they are added once after selection. Only the three modes exist.

`resolveRollMode(signals)` reads M4's ROLL_SIGNAL target state:

- no signal → NORMAL;
- duplicate signals collapse;
- Advantage + Disadvantage → `ROLL_MODE_CONFLICT` (M5-SC-032).

```
Roll 1 ─┐
        ├─ max ─► Selected Natural
Roll 2 ─┘
                 +
              Modifiers once
                 │
                 ▼
               Total
```

**Dynamic-signal limitation (§49).** An M4 plan cannot route a MODIFIER's signal output into a choice between two
Formula programs without new generic conditional execution. So the mode is a compile-time input: a caller resolves
signals with `resolveRollMode` and compiles the matching plan. M4 was not extended. A future approved Work Order may
add the dynamic aggregation.

## 12. Attack Roll

`ATTACK_ROLL` total = `natural + per + accuracy + bonuses`, compared `>=` against `TARGET_DODGE` (M5-I054).

The plan contains these steps:

1. natural selection;
2. the PER binding;
3. the ACCURACY derived step;
4. the attack bonus sum;
5. the total;
6. success;
7. critical threat;
8. critical hit;
9. the Stat Mastery signal.

```
Character Die
      +
PER
      +
Accuracy = floor(PRO / 3)
      +
Other Attack Bonuses
      │
      ▼
Attack Total
      │
      ▼
Dodge
```

## 13. Accuracy

`core.derived.accuracy`: `floor(pro / 3)` gives PRO 1–2 → 0, 3–5 → 1, 6–8 → 2, 9–10 → 3 (M5-I055).

It is its own M4 FORMULA step and its own variable in the Attack total, never folded into PER. It is not an Ability
Score.

## 14. Dodge

`core.derived.dodge`: `half_character_die + agi + perception_bonus + bonuses` (M5-I057).

- `perception_bonus` is the DERIVED statistic `DODGE_PERCEPTION_BONUS = floor(per / 3)`.
- Explicit Dodge bonuses (Partial Cover etc.) are named terms.
- No tactical source is hard-coded.

Evasion is legacy terminology for the same value (M5-I056).

```
Half Character Die
      +
AGI
      +
floor(PER / 3)
      +
Other Dodge Bonuses
      │
      ▼
Dodge
```

## 15. Criticals

- **Critical threat** — an M4 REQUIREMENT that the selected natural `==` the die faces (from ActorContext
  `character.die_faces`). Discarded Advantage / Disadvantage dice are never inspected.
- **Critical Hit** — an M4 `ALL` REQUIREMENT of (threat, total `>=` Dodge).
- A maximum natural never hits by itself (M5-I058 / M5-I059).
- Critical damage is `DEFERRED`: no damage step exists.

## 16. Saving Throws

`SAVING_THROW` total = `natural + stat_score + bonuses`, against `DIFFICULTY_CLASS` (M5-I060).

The Save Stat is the explicit `subject.stat`. It can be any of the six Stats, and a Save without one fails closed.
Targeting can never select a Save: the M5-I022 forbidden keys still apply (M5-I061). Choosing among several allowed
Saves belongs to the later Effect.

## 17. Character DC

`core.derived.character_dc`: `half_character_die + pro + resolve_bonus + bonuses` (M5-I062).

- `resolve_bonus` is `CHARACTER_DC_RESOLVE_BONUS = floor(res / 3)`.
- The DC is static: the half die is a statistic, not a roll.

```
Half Character Die
      +
PRO
      +
floor(RES / 3)
      +
Other DC Bonuses
      │
      ▼
Character DC
```

Inspection example (golden §127): Half d8 4 + Prowess 5 + Resolve +2 + Other +1 = **12**. Each term is its own step
or variable, traced and source-mapped.

## 18. HP

`core.derived.maximum_hp`: `base_hp + con` (M5-I063 / M5-I065).

Base HP is the racial starting value supplied by the CharacterCore, which in turn comes from the Ancestry Definition
in WO3. No race table lives in the formula.

## 19. MP

`core.derived.maximum_mp`: `base_mp + res` (M5-I064). The multiplicative source wording is superseded (M5-SC-003).

```
Race Base HP + CON
        │
        ▼
   Maximum HP


Race Base MP + RES
        │
        ▼
   Maximum MP


Runtime spending is WO3.
```

## 20. Strength Armor

`core.derived.strength_armor`: `floor(str / 3)` (M5-I066). This is natural Armor only. Equipment, shield and cover
Armor and the damage-reduction pipeline are later work.

## 21. AP Capacity

- `AP_AGILITY_BONUS = floor(agi / 3)`.
- `BASE_AP_CAPACITY = 3 + agility_bonus` (M5-I067).
- `COUNTER_ACTION_CAPACITY = 1`.

These are character statistics. AP and Counter Action runtime state belongs to WO3.

## 22. Base Range

`core.derived.base_range`: `15 * per`, M4 unit `ft` (M5-I068). Base Range is no precedent for Movement.

## 23. Mana Efficiency

`core.derived.base_mana_efficiency`: `pro` (M5-I069).

ME stays a payment pool (M5-SC-004, M5-I023). Nothing subtracts ME from a listed cost, and no content mentions a
discount. WO3 owns refresh and payment.

## 24. Signature Capacity

`core.derived.signature_ability_slots`: `pro` (M5-I070).

## 25. Stat Mastery

`core.resolution.stat_mastery` holds
`{levelAtLeast: 10, statAtLeast: 10, signal: ADVANTAGE, appliesTo: [ATTACK_ROLL, CORE_ROLL, SAVING_THROW, SKILL_CHECK]}`
(M5-I072).

Each applicable roll compiles an M4 **MODIFIER** with a `ROLL_SIGNAL` target and an `ALL` condition:
`character.level >= 10` and `stat.score >= 10`, both facts bound from the ActorContext.

The output is an ADVANTAGE signal. It is never a number: the total is unchanged, and the Stat stays 10. The payload
cannot express a bonus. The signal is turned into a mode by `resolveRollMode` (§11).

## 26. M4 Compilation

`compileCoreResolution({contractVersion: 1, subject, definitions, ruleset, character})` produces a
`ProwessCoreCompiledPlan`:

- `evaluationPlan` — an M4 plan;
- `sourceMap`;
- `outputs` — the step keys of natural, total, success, criticalThreat, criticalHit, automaticTotal,
  automaticSuccess, statMasterySignal and each derived statistic.

**Subjects:**

- `CORE_RESOLUTION` with `procedure`, plus `mode` / `stat` / `skillKey` / `attemptPermitted` as the procedure requires;
- `DERIVED_STATISTICS`.

| WO2 rule | M4 primitive |
| --- | --- |
| natural selection, totals, half die, HP, MP, Accuracy, Dodge, DC, Armor, AP, Range, ME, slots, bonus sums | FORMULA |
| total ≥ DC / Dodge, natural == faces, critical hit, automatic success, rank requirements | REQUIREMENT |
| Stat Mastery prerequisites → ADVANTAGE | MODIFIER (ROLL_SIGNAL) |
| runtime HP / MP / AP | not compiled (WO3) |

**Plan structure:**

- Step order is explicit: bonus sums at −1, derived statistics 0…n in M4 dependency order, then roll steps from 1000.
- Step keys are `prowess:<CORE_RESOLUTION|DERIVED_STATISTICS>:<subjectKey>:<fragment>`.
- A **Skill Check** plan contains both the automatic-success fragments and the rolled fragments, and both run.
  Choosing which result to use is a later workflow decision. There is no hidden conditional execution (§53).
- WO1's `COMPONENT_COMPILERS` stays the Ability component table.
- The core compiler is a separate, static, explicit entry point. It has no registry and runs no content callbacks.
- WO1's `assembleCompiledPlan` was generalized into `assembleFragments`, which is shared by both compilers.
- Compiled plans run under the existing M4 orchestrator, so the M4 Explanation and Rules Inspector work on them
  unchanged.

## 27. Provenance

Every compiled step has a source-map entry. It names the step's component keys (`procedure.ATTACK_ROLL`,
`derived.ACCURACY`, `stat.PER`, `skill-rank`, `character-die`, `procedure.STAT_MASTERY`) and the exact Definition
refs behind it.

Every FORMULA program, REQUIREMENT node and MODIFIER carries the exact Definition's M4 `RuleProvenance` (entity,
version, canonical key, Ruleset, Manifest).

Definitions are indexed by role from the exact bundle. A missing role fails with `MISSING_CORE_DEFINITION`, and two
Definitions claiming one role fail with `AMBIGUOUS_CORE_DEFINITION`. There is no first-wins, no fallback and no
latest / current lookup. The bundle is re-validated against the request's exact RulesetContext.

## 28. Determinism

- No randomness, clock, environment or module state (the static audit forbids them).
- Equal requests give deep-equal, deep-frozen, JSON-round-trippable plans.
- Bundle order does not matter.
- Inputs are never frozen or mutated.
- Getters, prototype keys, cycles, functions and non-finite numbers are refused before reading.

Exact Release history is reproducible. The database test publishes R1 with the 30 Definitions, evaluates it,
publishes R2 with changed values, and re-evaluates R1 identically, both concurrently and in isolation.

## 29. Remaining Source Conflicts

- **M5-SC-006 Movement** — UNRESOLVED. Calculation is `DEFERRED_PENDING_CANON`: no executable formula, and a Movement
  DERIVED_STAT is refused.
- **M5-SC-032 Advantage + Disadvantage** — UNRESOLVED; fails closed.
- **M5-SC-007 Concentration** and **M5-SC-011 Arcane / Arcana Rank** — untouched.
- **M5-SC-030 Skill list** — WO2 needs only Skill canonical keys.

## 30. WO3 Boundary

WO3 owns:

- Ancestry Definitions (the source of Base HP / MP);
- the Skill catalog;
- runtime Resources (current HP / MP, spending, restoration, refresh, temporary pools);
- AP and Counter Action runtime state;
- ME payment.

WO2 only derives capacities and statistics through M4 FORMULA and compiles no Resource transition (M5-I074).
