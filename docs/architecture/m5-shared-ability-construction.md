# M5-WO5 — Shared Modular Ability Construction Framework

## 1. Scope

M5-WO5 turns the WO1 structural `AbilityComposition` grammar into executable construction-legality rules. It answers one question: **can this exact character legally construct this exact Spell or Maneuver under this exact Ruleset?**

It owns access, rank-based capacity, Spell-only Effect-to-Trait exchange, component prerequisites, explicit Effect stacking and Signature Ability capacity. It does **not** calculate Spell or Maneuver costs, author the Targeting / Effect / Trait catalogs, execute Effect Chains, resolve attacks/saves, or mutate runtime resources. Those belong to later M5 Work Orders.

All Prowess-specific semantics live in `@prowess/game`. M4 remains frozen. Numeric capacity transformations and legality comparisons compile into existing M4 `FORMULA`, `KEYWORD` and `REQUIREMENT` operations.

## 2. Source Authority and Locked Designer Rulings

Authority order remains: approved designer rulings → Canon decisions → Core Playtest V0.1 → older supporting documents.

The eight WO5 rulings are locked:

1. A Spell needs a valid construction Authority: Arcane Rank **Trained+**, or a relevant Affinity Rank **Trained+** under Affinity Authority.
2. Martial Rank is the **Martial Skill rank**. Trained / Expert / Master have Rank Values 1 / 2 / 3.
3. A Spell may trade **1 unused Effect slot for +1 Trait slot** repeatedly, but must retain at least one Effect. Maneuvers do not receive this trade rule.
4. Arcane Authority has the same base structural Effect/Trait capacities as Affinity Authority: 1/1, 2/2, 3/3. Arcane supplies breadth; Affinity supplies specialization/efficiency. Capacities never add.
5. Spell Casting Condition capacity comes only from **Arcane Rank**, regardless of selected Spell Authority: Untrained 0, Trained 1, Expert 2, Master 3.
6. A permanent player-created/known Signature Ability consumes exactly **1 Signature slot** by default. Signature Ability capacity equals PRO.
7. Avoiding a Signature slot requires an explicit authored exemption. There is no unlimited non-Signature personal Ability pool by default.
8. An Effect stacks only if its Definition explicitly says it is stackable and explicitly defines its stack limit/rule. Rank Value is never an implicit universal stack cap.

## 3. Versioned Construction Rule

The numeric construction table is structured, versioned content rather than compiler constants:

`ABILITY_CONSTRUCTION_RULE` → `ability.construction_rule`

The payload contains:

- existing Skill-rank identity (`UNTRAINED`, `TRAINED`, `EXPERT`, `MASTER`);
- construction-specific Rank Value;
- Arcane Effect/Trait/Casting-Condition capacities;
- Martial Effect/Trait/Maneuver-Condition capacities;
- maximum Spell Trait trades;
- minimum Spell construction ranks;
- minimum one Spell Effect;
- default Signature slots per Ability and the PRO capacity stat.

This content is pinned by the exact Ruleset/Manifest like every other canonical Prowess Definition. A historical Release therefore keeps its historical construction capacities even if a later Release changes them.

## 4. Existing Skill Ranks, Not New Progression Tracks

`Arcane Rank` means the character's **Arcana Skill rank**. `Arcana Rank` is legacy terminology.

`Martial Rank` means the character's **Martial Skill rank**.

WO5 does not create Arcane or Martial progression tracks. The generic Skill rank ladder remains the source of ordering, while `ABILITY_CONSTRUCTION_RULE` supplies the construction-specific numeric meaning of those ranks.

## 5. Spell Access

A Spell Composition explicitly selects exactly one construction Authority:

```text
Spell
  ├─ Arcane Authority
  │    └─ Arcana Skill must be Trained+
  │
  └─ Affinity Authority
       └─ exact governing Affinity must be owned at Trained+
```

No Authority is auto-selected. Arcane and Affinity capacities never add.

### Arcane Authority

Arcane Authority is the broad path. Once its rank prerequisite is satisfied, branch component prerequisites still apply, but the component need not be aligned to one Affinity.

### Affinity Authority

Affinity Authority is the specialized path. The exact governing Affinity must be an exact owned Affinity Version from the same Ruleset. Every selected component must either:

- match a Strength or Weakness rule of that Affinity through exact structured Keywords; or
- have an explicit authored access grant.

The implementation uses M4 Keyword Resolution plus Requirement evaluation. It never infers access from display names or prose.

## 6. Spell Capacity

Base Arcane Authority capacity:

| Arcane Rank | Effects | Base Traits | Casting Conditions | Max Effect→Trait Trades |
| --- | ---: | ---: | ---: | ---: |
| Untrained | 0 | 0 | 0 | 0 |
| Trained | 1 | 1 | 1 | 0 |
| Expert | 2 | 2 | 2 | 1 |
| Master | 3 | 3 | 3 | 2 |

Affinity Authority Effect/Trait capacities continue to come from the exact WO4 Affinity Rank rule. The same 1/2/3 structural scale is used, but Affinity Rank never grants Casting Condition slots.

## 7. Casting Condition Capacity Is Arcane-Only

Casting Condition capacity is evaluated independently of selected Spell Authority:

```text
Arcana Skill Rank
      │
      ├─ Untrained → 0
      ├─ Trained   → 1
      ├─ Expert    → 2
      └─ Master    → 3
```

Therefore:

- Arcane Trained + Affinity Authority → 1 Casting Condition slot.
- Arcane Untrained + Master Affinity Authority → 0 Casting Condition slots.

This is M5-I157.

The later Casting Condition cost Work Order still owns the flat 30% total reduction cap and each Condition's Requirements.

## 8. Spell Effect-to-Trait Exchange

A Spell may exchange unused Effect capacity:

```text
1 unused Effect slot = +1 Trait slot
```

The Spell must retain at least one Effect.

Legal maximum layouts:

- Trained: `1E / 1T`
- Expert: `2E / 2T` or `1E / 3T`
- Master: `3E / 3T`, `2E / 4T`, or `1E / 5T`

M4 Formula steps compute effective Effect and Trait capacity:

```text
effectiveEffects = baseEffects - trades
effectiveTraits  = baseTraits + trades
```

M4 Requirement steps then compare used slots to those effective capacities. The compiler does not perform a hidden final capacity calculation.

Maneuvers do not use this exchange rule in WO5.

## 9. Maneuver Access and Capacity

Maneuver construction requires Martial Skill Trained+.

| Martial Rank | Rank Value | Maneuver Effects | Maneuver Conditions |
| --- | ---: | ---: | ---: |
| Untrained | 0 | 0 | 0 |
| Trained | 1 | 1 | 1 |
| Expert | 2 | 2 | 2 |
| Master | 3 | 3 | 3 |

Maneuver Traits exist architecturally but no canonical Maneuver Trait catalog is authored yet. WO5 therefore supplies structural Trait capacity without inventing catalog content.

Targeting Conversion remains a Maneuver Effect and therefore consumes an Effect slot under the M5-SC-015 designer ruling.

## 10. Component Prerequisites

A component Definition may author structured access requirements. WO5 supports the shared access primitives needed by the next catalog Work Orders:

- exact Skill Rank requirement;
- exact Affinity ownership + minimum Affinity Rank;
- `ALL` / `ANY` groups of those requirements.

These compile into M4 `RANK_AT_LEAST`, `ENTITY_OWNED` and group Requirements. A not-satisfied prerequisite is a legal evaluation result, not an engine error.

Costs, component-specific compatibility matrices and more specialized prerequisite kinds remain with the owning catalog Work Orders.

## 11. Explicit Effect Stacking

Default: an Effect is **not stackable**. Repeating a non-stackable Effect uses another Effect slot.

A stackable Effect Definition must explicitly contain a stacking rule. The rule owns both permission and limit. Supported structural limit sources are:

- fixed authored maximum;
- an explicitly named Skill Rank Value;
- governing Affinity Rank Value.

The presence of a character Rank never silently creates a stack limit. A stackable Effect's repeated instances collectively use one Effect slot, but later cost Work Orders still charge each stack's authored AP/MP contribution.

## 12. Signature Ability Capacity

WO2 established:

```text
Signature Ability Capacity = PRO
```

WO5 establishes the candidate slot rule:

```text
Permanent player-created/known Ability = 1 Signature slot
```

The projected slot count compiles through an M4 Formula and Requirement. A candidate can use zero slots only when an explicit authored exemption key is supplied. Complexity does not make one Ability consume multiple slots unless a future explicit rule says so.

## 13. M4 Compilation

WO5 emits only existing M4 primitives:

```text
Prowess character + exact Ability Composition
                   │
                   ▼
      exact construction Definitions
                   │
         ┌─────────┼─────────┐
         ▼         ▼         ▼
      FORMULA    KEYWORD   REQUIREMENT
         │         │         │
         └─────────┴─────────┘
                   │
                   ▼
             legality result
```

M4 performs numeric transforms and comparisons. `@prowess/game` provides the exact authored facts and Prowess interpretation.

No M4 source is modified by WO5.

## 14. Exact Provenance and Source Mapping

Every compiled step retains exact Ruleset provenance and maps to its exact Prowess Definition/component via `ProwessCompilationSourceMap`.

The construction rule, Skill rank ladder, governing Affinity, Affinity rank rule and component Definitions remain individually traceable. There is no `latest` / `current` lookup.

## 15. Runtime / Persistence Boundary

Construction evaluation is pure. It does not:

- save a Spell or Maneuver;
- consume a Signature slot in the database;
- change Skill/Affinity ranks;
- spend AP/MP/ME;
- publish canon;
- mutate an EntityVersion.

A later Character/Studio workflow may persist an approved Composition explicitly.

## 16. Out of Scope / Next Work Orders

WO5 intentionally does not author or execute:

- complete Spell/Maneuver Targeting catalogs;
- Spell or Maneuver Effect catalogs;
- Spell/Maneuver Trait catalogs;
- Duration catalogs;
- Casting/Maneuver Condition catalogs and cost reductions;
- Spell MP/AP calculation;
- Maneuver AP/MP calculation;
- Effect Chain runtime resolution;
- Sustain, Mana Lock or Concentration runtime mechanics.

Those remain WO6–WO13.
