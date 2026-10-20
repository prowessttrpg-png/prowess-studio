# M5-WO6 — Targeting Framework, Geometry, Range & Spell / Maneuver Targeting Catalogs

PAS-10 M5-WO6, Work Order v1.0. This document describes how `@prowess/game` makes Targeting a structured rules
subsystem. Targeting answers WHERE, WHO, HOW FAR, WHAT SHAPE, HOW MANY, FROM WHERE and PLACEMENT. It never answers WHAT
HAPPENS.

- **Guarded by:** `M5-I159`–`M5-I178` (see `m5-invariants.md`) and the CI gate **"M5-WO6 audit — Targeting
  framework, geometry & branch catalogs"**.
- **Content:** `packages/prowess-game/src/content/core-playtest-v0.1/targeting.json`.
- **Code:**
  - `vocabulary/targeting.ts`
  - `definition/targeting-payload.ts`
  - `targeting/compile.ts`

## 1. Scope

In scope:

- The typed `rules.targeting` sub-contract and typed LISTED Targeting cost contributions.
- The Spell Targeting catalog (10 Definitions) and the Maneuver Targeting geometry catalog (9 Definitions).
- Default Spell Range, Spell areas, Maneuver Radius and Targeting scaling options.
- Line of Sight, Line of Effect and cover policy.
- Exact component ↔ Targeting compatibility.
- Targeting Keywords.
- `compileAbilityTargeting`, `readAbilityTargetingRun` and `evaluateAbilityTargeting`.

Out of scope:

- Effects and their resolution (WO7, WO12).
- Traits, including Widen Area (WO8).
- Final Spell MP and AP (WO10), and Maneuver AP (WO11).
- Runtime payment.
- A map engine (coordinates, ray tracing, pathfinding).
- Builder UI and any new endpoint.

## 2. Source Authority

Precedence is designer rulings first, then approved CanonDecisions, then Core Playtest V0.1, then older sources. The
lower-authority Chapter Book never supplies a canonical value; for example, its Projectile value of 2 MP is not used.

Spell Targeting cites these Core Playtest locators:

- s25 (Base Range)
- s628–s632 (Targeting Types, Spell Range and Area Scaling, Targeting Scaling, "Targeting does not determine the Save")
- s750–s775 (Targeting Type sections, range, Line of Sight / Effect, cover)
- s842

Maneuver Targeting cites s1984, s1998–s2006 (AoE Maneuvers, AoE Origin, Radius Formula) and s2027–s2029.

## 3. Targeting vs Effect

Targeting owns delivery: range, area, target count, origin, placement and Line of Sight / Effect. The Effect owns
resolution: Attack Roll, Saving Throw, Save Stat, Character DC, success / failure outcomes, damage, healing and statuses
(M5-I022, M5-I159, M5-I160).

`TARGETING_FORBIDDEN_KEYS` refuses outcome, resolution, save, saveStat, saveProfile, savingThrow, attackRoll, damage,
healing, status and similar keys at any depth.

Touch and Projectile carry `deliveryFamily: DIRECT_ATTACK_DELIVERY`. This is a classification of the typical delivery
only; it never transfers resolution to Targeting.

```text
Ability
  │
  ▼
Exact Branch Targeting Definition
  │
  ├── Range
  ├── Target Count
  ├── Geometry
  ├── Origin
  ├── Placement
  ├── LoS / LoE
  └── Cost Contribution
  │
  ▼
Effect

Effect decides what happens.
```

## 4. One Targeting Rule

Every Ability Composition has exactly one `targeting` use. It is never `targeting[]` (WO5).

A standard multi-Effect Spell shares that one Targeting across all of its Effects (M5-SC-022, M5-I161). There is no
per-Effect base Targeting. Only an explicit modifier changes this: a Trait, a Metamagic rule or a special rule, passed as
`targetingModifiers` (implemented in later Work Orders).

## 5. Branch Separation

`SPELL_TARGETING` and `MANEUVER_TARGETING` are separate DefinitionKinds, both stored under EntityType `TARGETING`. Using
a Spell Targeting Definition in a Maneuver is the WO1 `CROSS_BRANCH_DEFINITION` error (M5-I162).

## 6. Shared Geometry

A semantic shape is a neutral classifier:

SELF, TOUCH, SINGLE_TARGET, MULTI_TARGET, PROJECTILE, LINE, CONE, RADIUS, ZONE, AURA, CHAIN

The generic layer defines what a measure means (LENGTH, WIDTH, RADIUS). The branch Definition supplies the formula.

```text
Shared Semantic Shape: RADIUS
            │
      ┌─────┴─────┐
      ▼           ▼
Spell Radius   Maneuver Radius
5 × PRO        RankBase × STR

Different Definitions.
Shared geometry concept.
```

## 7. Spell Targeting Catalog

| Definition | Shape | Base MP | Range model | Area |
| --- | --- | --- | --- | --- |
| `spell.targeting.self` | SELF | 0 | SELF | — |
| `spell.targeting.touch` | TOUCH | 1 | TOUCH | — |
| `spell.targeting.single_target` | SINGLE_TARGET | 3 | DEFAULT_SPELL_RANGE | — |
| `spell.targeting.multi_target` | MULTI_TARGET | 5 | DEFAULT_SPELL_RANGE | — |
| `spell.targeting.projectile` | PROJECTILE | deferred (M5-SC-039) | DEFAULT_SPELL_RANGE | — |
| `spell.targeting.line` | LINE | 5 | SELF (origin = caster) | LENGTH 15 × PRO; WIDTH deferred (M5-SC-040) |
| `spell.targeting.cone` | CONE | 5 | SELF (origin = caster or a point) | LENGTH 10 × PRO |
| `spell.targeting.radius` | RADIUS | 6 | DEFAULT_SPELL_RANGE | RADIUS 5 × PRO |
| `spell.targeting.zone` | ZONE | 8 | DEFAULT_SPELL_RANGE | RADIUS 5 × PRO |
| `spell.targeting.aura` | AURA | 6 | SELF (follows its source) | RADIUS 5 × PRO |

## 8. Projectile Canon

Projectile is a canonical Spell Targeting Type (M5-SC-016). It is an Attack-Roll-oriented, traveling delivery with one
primary target and default Spell Range.

It shares single-target cardinality with Single Target, but it is a distinct exact Definition: Projectile is never
treated as Single Target (M5-I163).

## 9. M5-SC-039

The Projectile Base MP cost is `UNRESOLVED`. The Projectile Definition lists its base contribution as
`BASE_DEFERRED { conflictKey: "M5-SC-039" }`, and the result reports `cost.base.status = DEFERRED_PENDING_CANON` plus a
`deferred` entry. No 2, 0 or 3 MP value is authored.

This does not block Projectile identity, range, target count, delivery, compatibility or provenance. M5-WO10 must
resolve M5-SC-039 before complete Projectile Spell pricing can pass.

## 10. Trigger / Glyph Add-On Correction

Designer ruling M5-SC-029: Trigger-Based and Glyph / Anchor are add-ons (`TARGETING_ADD_ONS`: TRIGGER, ANCHOR) applied
to an already-created Spell. They are not base Targeting Types.

- The historical WO1 shapes TRIGGERED and ANCHOR stay readable in WO1-era payloads.
- A Definition with executable `rules.targeting` that uses them, or a composition that uses one, fails with
  `PROWESS_TARGETING.TARGETING_ADD_ON_AS_BASE` (M5-I164).
- No canonical `spell.targeting.trigger_based`, `spell.targeting.glyph` or `spell.targeting.anchor` exists.
- The +4 / +5 MP source costs are superseded. Exact add-on pricing is deferred and is not invented.

```text
Base Spell Targeting
       │
       ▼
Completed Spell
       │
       ├── Trigger Add-On
       └── Glyph / Anchor Add-On

Neither Add-On replaces the base Targeting Type.
```

## 11. Spell Range

`DEFAULT_SPELL_RANGE` reuses the WO2 `BASE_RANGE` derived statistic (`core.derived.base_range`, 15 × PER). Its program
is emitted as an M4 FORMULA step and bound into the Targeting's range Formula, `base_range + range_extension * 15`. There
is one rule for Spell Range, not two (M5-I165). At PER 4 the range is 60 ft.

## 12. Range vs Area

Range is how far away the origin or target may be. Area is how much space the Targeting affects after reaching that
origin. They are separate steps and separate outputs (M5-I166). Example: PER 5 and PRO 3 give a range of 75 ft and a
radius of 15 ft.

```text
Caster
  │
  │  Range = 15 × PER
  ▼
Target / Origin Point
  │
  ▼
Area Geometry
  ├── Line
  ├── Cone
  ├── Radius
  ├── Zone
  └── Aura
```

## 13. Self

| Property | Value |
| --- | --- |
| Valid target | the caster |
| Target count | 1 |
| Range model | SELF |
| Base MP | 0 |
| Area | none |

Self does not make an Effect Automatic.

## 14. Touch

| Property | Value |
| --- | --- |
| Reach | contact / melee reach |
| Target count | 1 |
| Base MP | 1 |
| Line of Sight | NOT_REQUIRED |
| Line of Effect | REQUIRED |

Whether the target is willing or unwilling is Effect / runtime policy. Targeting adds no Attack Roll step.

## 15. Single Target

One creature, object or point, at default Spell Range. Base MP 3. Line of Sight and Line of Effect are both REQUIRED.

## 16. Multi-Target

`cardinality: SELECTED` reads the declared COUNT parameter `targetCount`, minimum 2. There is no invented base count: a
use that omits the count is reported as `NOT_SELECTED`. An explicit count is checked by an M4 REQUIREMENT (`>= 2`). Each
target stays independently addressable; Effect Chains are WO12. The scaling "+1 Multi-Target target → +3 MP" is
recorded as `PER_ADDITIONAL_TARGET`.

## 17. Projectile

One primary target, default Spell Range, Line of Sight / Effect REQUIRED, and cover exposed to resolution. The base MP is
deferred (§9).

## 18. Line

- **Shape:** a straight path from the caster.
- **Length:** LENGTH = `15 * pro + length_extension * 10`.
- **Width:** DEFERRED (§19).
- **Base MP:** 5.
- **Scaling:** +10 ft length → +3 MP; +5 ft width → +4 MP.
- **Widen Area:** a Line is not radius-capable, so Widen Area never applies to it.

## 19. M5-SC-040

The base Line width rule is "5 ft wide per 2 Prowess". No source defines its rounding for odd PRO, its value at PRO 1,
or a minimum width.

The Spell Line Definition stores the rule as `{ measure: WIDTH, valueStatus: DEFERRED_PENDING_CANON, conflictKey:
M5-SC-040, ruleText }`. No width step is emitted, and the result reports the width as null with the conflict (M5-I167).

## 20. Cone

LENGTH = `10 * pro + length_extension * 10`. The origin is the caster or a chosen point. Base MP 5. Scaling: +10 ft
length → +3 MP (M5-I168).

## 21. Radius

The center is a point chosen within default Spell Range, and RADIUS = `5 * pro`. Base MP 6. The Definition is
radius-capable (M5-I169).

## 22. Zone

The center is a point chosen within range, and RADIUS = `5 * pro`. Base MP 8. Scaling: Mobile Zone (a FLAG) → +5 MP.
Zone defines the area only. Damage ticks, entry effects, Duration, Sustain and Mana Lock belong to the Effect and
Duration systems.

## 23. Aura

- **Shape:** RADIUS = `5 * pro`, emanating from an authored source.
- **Placement:** follows its source (`FOLLOWS_SOURCE`).
- **Base MP:** 6.
- **Sources:** CASTER by default; SUMMON / OBJECT / ANCHOR through the declared `sourceRef` TOKEN parameter, at +4 MP
  (s631). Only the authored sources are legal.

## 24. Targeting Scaling

Scaling options are declared parameters (STEPS, COUNT, FLAG, TOKEN) paired with typed cost contributions. A use may set
only the parameters its exact Definition declares (`UNDECLARED_TARGETING_PARAMETER`). An arbitrary value such as
`radius: 5000` never overrides a canonical Formula. Selections are reported; WO10 prices them.

| Option | Parameter | Listed |
| --- | --- | --- |
| +15 ft Spell Range | `rangeExtension` (STEPS) | +2 MP per step |
| +10 ft Line length | `lengthExtension` | +3 MP per step |
| +5 ft Line width | `widthExtension` | +4 MP per step |
| +10 ft Cone length | `lengthExtension` | +3 MP per step |
| +1 Multi-Target target | `targetCount` (COUNT) | +3 MP per additional target |
| Mobile Zone | `mobile` (FLAG) | +5 MP |
| Aura from summon / object / anchor | `sourceRef` (TOKEN) | +4 MP |

## 25. Widen Area Boundary

The old "+10 ft Radius / Zone / Aura → +3 MP" scaling is superseded (M5-SC-024, M5-I170) and is absent from content.

Widen Area (+6 MP) is a Targeting Trait owned by WO8. WO6 supplies only the explicit `radiusCapable` metadata, which is
true exactly when a RADIUS measure is authored. It is never inferred from a name.

## 26. Line of Sight

The `lineOfSight` policy is one of REQUIRED, NOT_REQUIRED, CONDITIONAL or INHERITED. Most Spells require sight of the
target or origin. Maneuver Targeting INHERITS the Foundation's policy. There is no ray tracing.

## 27. Line of Effect

The `lineOfEffect` policy uses the same vocabulary. Most Spells require the magic to reach the target or origin.

## 28. Cover

The `cover` policy is EXPOSED_TO_RESOLUTION, NOT_APPLICABLE or INHERITED. It is resolution-neutral metadata. Partial
Cover never makes Targeting choose a Save, a Save bonus or a Dodge value. Full Cover blocking direct targeting is
runtime / resolution policy.

## 29. Compatibility

A component's `compatibility: [{ relation: "TARGETING", allow }]` lists exact Targeting canonical keys or semantic
tokens. One M4 REQUIREMENT checks it:

`ANY [ ANY(SET_CONTAINS identity ∋ allowLabel …), SET_CONTAINS modifiers ∋ componentKey ]`

The identity set is `{ exact canonical key, semantic shape }`. The result for each component is one of:

- COMPATIBLE
- INCOMPATIBLE
- MODIFIED_BY_EXPLICIT_RULE
- NOT_DECLARED

There is no substring, display-name or prose matching (M5-I171). WO7 supplies the Effect catalog's compatibility data.

## 30. Maneuver Targeting

| Definition | Shape | Range model | Geometry |
| --- | --- | --- | --- |
| `maneuver.targeting.self` | SELF | SELF | — |
| `maneuver.targeting.touch` | TOUCH | TOUCH | — |
| `maneuver.targeting.single_target` | SINGLE_TARGET | FOUNDATION_RANGE | — |
| `maneuver.targeting.multi_target` | MULTI_TARGET | FOUNDATION_RANGE | selected count ≥ 2 |
| `maneuver.targeting.line` | LINE | FOUNDATION_RANGE | Effect-defined |
| `maneuver.targeting.cone` | CONE | FOUNDATION_RANGE | Effect-defined |
| `maneuver.targeting.radius` | RADIUS | FOUNDATION_RANGE | RankBase × STR |
| `maneuver.targeting.chain` | CHAIN | FOUNDATION_RANGE | Effect-defined |
| `maneuver.targeting.zone` | ZONE | EFFECT_DEFINED | Effect-defined |

There is no Maneuver Aura. A Foundation's normal Targeting is explicit content: the Foundation's own TARGETING
compatibility rule. Nothing is inferred from names.

## 31. Targeting Conversion Boundary

A Targeting Conversion is a Maneuver Effect (M5-SC-015 / M5-SC-017). It owns the conversion, the Save Profile, the
AP / MP cost and the Effect slot (WO7).

MANEUVER_TARGETING Definitions carry geometry and delivery only. They have no cost contributions
(`MANEUVER_TARGETING_COST`) and no Save Profile (M5-I172).

```text
Maneuver Foundation
       │
       ▼
Normal Targeting
       │
       ▼
Targeting Conversion Effect
       │
       ├── pays Effect cost
       ├── owns Save Profile
       ├── consumes Effect slot
       └── references destination Targeting
                       │
                       ▼
               Maneuver Geometry
```

## 32. Maneuver Radius

Designer ruling M5-SC-018: Radius = Martial Rank Base × STR.

- The rank table `MARTIAL_RANK_BASE` (Martial Skill) is TRAINED 5, EXPERT 10, MASTER 15 ft.
- The Formula `rank_base * str` is executed by M4.
- Goldens: Trained STR 4 → 20 ft; Expert STR 4 → 40 ft; Master STR 4 → 60 ft; Master STR 10 → 150 ft; Expert STR 5 →
  50 ft.
- The superseded STR bands are never executed (M5-I173, M5-I174).
- An untrained rank has no authored base and yields `NOT_AUTHORED_AT_RANK`.
- Origins (THROWN_IMPACT, RANGED_IMPACT, PROJECTILE_IMPACT, PERFORMER) are chosen explicitly or left to the Conversion
  Effect.

## 33. M4 Mapping

| Concern | M4 operation |
| --- | --- |
| BASE_RANGE (WO2 statistic) | FORMULA (its own content program) |
| Range, LENGTH, RADIUS | FORMULA (content programs; BASE_RANGE bound by a STEP binding) |
| Multi-Target count, parameter bounds | REQUIREMENT `NUMERIC_COMPARE >=` |
| Compatibility | REQUIREMENT `ANY` / `SET_CONTAINS` |
| Targeting Keywords | KEYWORD |

M4 knows no Prowess Targeting term (M5-I175). The source map entry of every step cites its exact Definitions.

## 34. Provenance

Each step cites:

- the exact Targeting EntityVersion;
- the BASE_RANGE statistic it reads, or the Skill ladder used for a rank table.

The plan carries the exact Ruleset / Manifest / Release. Each Keyword contribution keeps the Targeting's EntityVersion
as its source (M5-I176).

## 35. Historical Releases

Definitions resolve only through the request's exact Ruleset bundle. A bundle from another Ruleset is refused.

- **History:** R1 pins Radius v1. After R2 changes the test geometry, R1 still re-evaluates identically.
- **Isolation:** R1 and R2 evaluated in parallel never mix range, area, cost, compatibility, Keywords or provenance.
- **Persistence:** evaluation writes nothing.

## 36. Deferred Systems

| Item | Deferred to | Notes |
| --- | --- | --- |
| Projectile base MP (M5-SC-039) | WO10 | Must be resolved before Projectile pricing can pass. |
| Spell Line base width (M5-SC-040) | a canon ruling | |
| Trigger / Glyph add-on mechanics and pricing | later work | Not +4 / +5 MP. |
| Widen Area | WO8 | |
| Targeting Conversion Effects and their Saves / costs | WO7 | |
| Effect compatibility catalog data | WO7 | |
| Final Spell MP / AP | WO10 | |
| Maneuver AP / MP | WO11 | |
| Effect Chains | WO12 | |
| Runtime target selection, positions and map geometry | not planned | Never part of Targeting. |

WO6 does not begin M5-WO7.
