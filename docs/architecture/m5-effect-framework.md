# M5-WO7 — Effect Framework, Resolution Contracts & Spell / Maneuver Effect Definitions

## 1. Scope

M5-WO7 activates `EFFECT` as executable structured Prowess content. It defines what an Effect is allowed to say, how an Effect describes resolution, access, scaling, Targeting compatibility, outcomes, stacking and listed AP/MP contributions, and how those rules compile through the existing M4 Formula / Requirement / Keyword primitives.

WO7 validates and compiles Effect Definitions and Effect Uses. It does **not** execute Effect Chains, mutate HP/MP/AP/Armor/position/Conditions, calculate final Spell or Maneuver cost, execute Traits, execute Duration, or manage Sustain / Mana Lock / Concentration.

The full Core Playtest Effect catalog is intentionally deferred to the structured content-authoring/import workflow. WO7 supplies a stable grammar and representative canonical fixtures.

## 2. Source Authority

Authority order for WO7 is:

1. explicit designer rulings;
2. approved Canon decisions;
3. Core Playtest Packet V0.1;
4. older Chapter Book material only where not superseded.

Lower-authority material is preserved as provenance and is never silently promoted over a higher-authority ruling.

## 3. Post-WO6 Designer Rulings

M5-SC-039 and M5-SC-040 are resolved by designer ruling for current canon. Historical WO6 Releases remain reproducible; they are not rewritten.

- M5-SC-039: Projectile base Targeting cost = **3 MP**; Projectile range = the caster's current applicable Range; Projectile imposes a **Ranged Attack Roll delivery check**.
- M5-SC-040: Spell Line length = **10 ft × PRO**; width = **5 ft × ceil(PRO / 2)**.

The old M5-I160, M5-I163 and M5-I167 remain historical records and are superseded rather than deleted.

## 4. Projectile Cost

`spell.targeting.projectile` current canon carries a listed Targeting contribution of exactly **3 MP**. This is a Targeting component cost contribution, not runtime payment and not final Spell cost.

## 5. Projectile Range

Projectile uses the caster's current applicable Range. Normally this is the existing Base Range system (`15 ft × PER`), but an exact Range modifier may change that value. Projectile does not reimplement `15 × PER` internally.

## 6. Projectile Delivery

Projectile's Targeting Definition may carry `rules.delivery.check = RANGED_ATTACK_ROLL`. Delivery is separate from the Effect outcome.

Canonical attack infrastructure is reused; no Projectile-only Accuracy system exists.

## 7. Projectile + Attack Effects

If a Projectile-delivered Effect uses `ATTACK_ROLL`, the Projectile delivery roll **is** the Effect attack roll. There is one roll, never two.

## 8. Projectile + Save Effects

If a Projectile-delivered Effect uses `SAVING_THROW`:

1. resolve Projectile Ranged Attack delivery;
2. a miss means the Effect was not delivered;
3. on a hit, resolve the Effect-owned Save Profile.

Targeting never chooses the Save.

## 9. Spell Line Amendment

Current canonical Line geometry:

- Length = `10 × PRO` feet.
- Width = `5 × ceil(PRO / 2)` feet.

Both execute through M4 Formula operations. No Studio/UI arithmetic owns these formulas.

## 10. Effect vs Targeting

Targeting answers **where/how the Ability reaches**. Effect answers **what happens**. Trait answers **how an Effect/Ability is modified**. Duration answers **how long it lasts**. Ability Conditions are **construction/use restrictions for a tradeoff**.

Targeting may impose a delivery check, but it never owns the Effect's mechanical outcome or Save identity.

## 11. Shared Effect Contract

The existing shared Effect payload remains authoritative:

- `effectFamily`
- `resolution`
- `outcomes`
- `keywords`
- `parameters`
- `compatibility`
- `costContributions`
- `rules`

WO7 adds typed `rules.effect` metadata rather than creating a second unrelated Effect model.

## 12. Spell / Maneuver Separation

`SPELL_EFFECT` and `MANEUVER_EFFECT` share the structural Effect contract but are exact branch-specific Definition families. A Spell Effect cannot occupy a Maneuver Effect slot and a Maneuver Effect cannot occupy a Spell Effect slot.

## 13. Canonical Spell Effect Branches

Exactly seven top-level Spell Effect families are canonical:

1. DAMAGE
2. HEALING
3. BUFF
4. DEBUFF
5. CONTROL
6. UTILITY
7. SUMMONING

No eighth top-level family is inferred from subfamilies or flavor.

## 14. Cleanse Subfamily

Cleanse is `HEALING / CLEANSE`. It removes only the exact harmful categories authored by its Definition. It does not imply HP restoration, MP restoration, or prevention of reapplication.

## 15. Movement Subfamily

Voluntary magical mobility is `UTILITY / MOVEMENT`. Forced enemy reposition is normally `CONTROL / FORCED_MOVEMENT`.

## 16. Spell Interference

Counterspell / Dispel-style interference is a specialized UTILITY mechanic, not a top-level Spell Effect family.

## 17. Typed Effect Rule Contract

`rules.effect` may express:

- branch;
- optional subfamily;
- Targeting compatibility / target-category restrictions;
- resolution policy;
- attack type;
- Save Profile and Save-selection policy;
- parameters and explicit scaling formulas;
- stack policy through the existing WO5 contract;
- Duration compatibility / Sustain eligibility metadata;
- structured prerequisites through WO5;
- structured outcomes;
- Effect-specific restrictions;
- optional exact destination Targeting reference for Maneuver Targeting Conversion.

## 18. Resolution Modes

Executable canonical Spell Effects use exactly one existing mode:

- `ATTACK_ROLL`
- `SAVING_THROW`
- `AUTOMATIC`

A canonical executable Spell Effect cannot omit resolution. A Maneuver Effect may structurally use `resolution = null` only when `rules.effect.resolutionPolicy = INHERIT_ABILITY` explicitly says to inherit the Maneuver foundation's resolution.

## 19. Effect Success / Failure

Normalized semantics:

- ATTACK_ROLL Success = attack hits; Failure = attack misses.
- SAVING_THROW Success = target fails the Save; Failure = target succeeds.
- AUTOMATIC Success = application requirements are satisfied; Failure = authored application requirements are not met.

These Effect semantics are distinct from Projectile delivery success/failure.

## 20. Outcomes

Outcome keys are deterministic (`SUCCESS`, `FAILURE`) and mechanical meaning is represented as structured authored operations. Outcome behavior must not live only in prose.

WO7 validates outcome structure but does not execute it.

## 21. Targeting Compatibility

Every Effect explicitly defines legal Targeting compatibility using exact canonical identity and/or exact semantic tokens. Display names, substrings and descriptive prose are never used for compatibility.

For a completed Ability, every Effect must accept the Ability's one selected Targeting Definition unless an explicit later modifier grants compatibility.

## 22. Access / Prerequisites

Effect access reuses WO5 structured prerequisites and WO4 Affinity access. It may require Arcane Rank, Martial Rank, Skill Rank, Affinity Rank or another exact structured requirement. Prose is never parsed for access.

## 23. Cost Contributions

Effects may carry listed AP, MP, or both as construction cost contributions. ME is not an Effect construction currency. These values are never paid during Definition evaluation.

## 24. Scaling

Scaling exists only when explicitly exposed by an Effect parameter/formula. Players cannot arbitrarily increase damage, healing, distance, target count, duration or stacks.

Numeric formulas compile through M4 Formula; parameter bounds compile through M4 Requirement where appropriate.

## 25. Character Dice Limits

For canonical Spell Damage / Healing Effects, selected Character Dice normally cannot exceed the caster's PRO unless an exact override exists. The check is **per Effect**, not across the entire Spell.

## 26. Damage Effects

DAMAGE represents direct harm. Structured data may include dice quantity, amount, damage type, resolution, valid targets, failure result and scaling. Runtime HP/Armor/Resistance handling is deferred.

Hybrid/split damage must remain representable without implementing the later damage engine.

## 27. Healing Effects

HEALING represents HP restoration, stabilization, recovery, Cleanse and explicitly authored restorative mechanics. Healing does not automatically remove Conditions.

## 28. Buff Effects

BUFF changes an exact beneficial value such as a Stat, Armor, Movement, roll, resistance, sense or damage output. It must identify the changed value, recipient, Duration compatibility, stacking behavior and limits.

## 29. Debuff Effects

DEBUFF impairs without necessarily hard-locking a target. It may alter costs, roll quality, defenses, range efficiency, positioning efficiency or available actions. Exact penalty and Save behavior remain Effect-owned.

## 30. Control Effects

CONTROL covers binding, forced movement, action denial, mobility denial and positioning control. Control Effects own their Save Profile.

## 31. Utility Effects

UTILITY includes detection, reveal, communication, object interaction, terrain interaction, movement/mobility and counterspell/interference. Utility Effects remain specific; there is no generic "solve encounter" Effect.

## 32. Summoning Effects

SUMMONING represents creation/manifestation of creatures, constructs, objects, equipment, structures or other summonable entities. WO7 validates structural Effect compatibility only; Summon stat blocks, tiers, dependent/independent behavior, AP and Fusion are later systems.

## 33. Duration Boundary

Effects may declare supported/default Duration concepts plus Sustain/Mana-Lock eligibility metadata. The Spell/Maneuver composition still owns the actual Duration component. WO7 calculates no Duration cost, Sustain cost, Mana Lock amount or Concentration.

## 34. Stackability

Stackability reuses WO5's explicit Definition-owned stack contract. If stackable, the exact Definition owns its stack limit. Rank Value is not a universal stack limit.

## 35. Effect Chains Boundary

Spell composition already preserves ordered Effect Uses. WO7 checks that Effect resolution/outcome metadata is sufficient for later chain execution. WO12 owns sequencing, branch behavior and the default rule that an unspecified Effect failure ends the chain.

## 36. Maneuver Effects

MANEUVER_EFFECT may modify weapon damage, convert damage type, alter Targeting, introduce Save-based resolution, alter reach/range, add control/Conditions, use MP/Affinity and perform other exact martial mechanics.

Maneuver damage normally comes from the Foundation/weapon unless an exact Maneuver Effect explicitly replaces it.

## 37. Inherited Resolution

Maneuver Effects such as elemental damage conversion may use `INHERIT_ABILITY`. Missing resolution is never interpreted as inheritance by default.

## 38. Save-Based Maneuver Effects

A Maneuver Effect may replace normal attack resolution with an authored Save Profile. The Effect owns the Save options, success/failure behavior and conversion rule.

## 39. Targeting Conversion Effects

Maneuver Targeting Conversion is owned by MANEUVER_EFFECT. The Effect owns:

- Martial Rank requirement;
- Effect-slot usage;
- AP/MP contribution;
- Save Profile / resolution rule;
- outcome;
- exact destination `MANEUVER_TARGETING` Definition reference.

The destination Targeting Definition owns geometry only and does not duplicate cost or Save Profile.

Current structured catalog: Sweep Attack, Cleave, Line Attack Conversion, Cone Attack Conversion, Radius Attack Conversion, Chain Attack and Zone Carve.

## 40. Elemental Conversion

Elemental Damage Conversion changes damage type only. It never automatically applies Burning, Shocked, Poisoned, Revealed, Mana Drain or another secondary Effect.

## 41. M4 Mapping

WO7 reuses:

- **M4 Requirement** — access, parameter limits, Targeting compatibility, Character Dice limit, stack limits where applicable;
- **M4 Formula** — distance, rank scaling, dice/number scaling and other numeric Effect formulas;
- **M4 Keyword** — exact Effect Keyword identity and provenance;
- **M4 Modifier** — metadata-compatible surfaces only; runtime Buff/Debuff application is deferred.

No Prowess Effect semantic is added to `@prowess/rules`.

## 42. Provenance

Every compiled validation/calculation maps to the exact Effect EntityVersion, exact Ability Effect Use, exact Ruleset, exact prerequisite/scaling rule and exact Keyword source. No `current`, `latest` or newest-version selection is permitted.

## 43. Historical Reproducibility

Historical Releases retain their pinned Effect/Targeting versions. Publishing revised current canon never mutates an earlier Ruleset. Concurrent R1/R2 evaluation remains isolated for cost, resolution, Save Profile, scaling, compatibility, outcomes and Keywords.

## 44. Deferred Systems

Explicitly deferred from WO7:

- final Spell cost — WO10;
- final Maneuver cost — WO11;
- Effect Chain execution — WO12;
- Trait mechanics — WO8;
- Duration mechanics — WO9;
- Sustain / Mana Lock / Concentration / Active Effects — WO13;
- runtime HP/MP/AP/Armor/Resistance/Condition/position mutation — later execution work;
- full Effect content authoring UI — M6.

## Ability Components

```text
Targeting
  │
  ▼
Effect
  │
  ├── Outcome
  ├── Resolution
  ├── Scaling
  ├── Access
  └── Cost Contribution
  │
  ▼
Trait
  │
  ▼
Duration / Conditions
```

Targeting = where/how. Effect = what.

## Projectile Resolution

```text
Caster Range
     │
     ▼
Projectile Targeting
3 MP Targeting Cost
     │
     ▼
Ranged Attack Delivery
     │
     ├── miss → Effect not delivered
     │
     └── hit
          │
          ▼
      Effect Resolution
        ├── Attack → same delivery roll
        ├── Save   → target now Saves
        └── Auto   → applies
```

## Spell Effect Branches

```text
SPELL EFFECT
│
├── Damage
├── Healing
│    └── Cleanse
├── Buff
├── Debuff
├── Control
├── Utility
│    ├── Movement
│    └── Counterspell / Interference
└── Summoning
```

## Maneuver Targeting Conversion

```text
Maneuver Foundation
      │
      ▼
Maneuver Effect
Targeting Conversion
      │
      ├── Rank Requirement
      ├── AP / MP Contribution
      ├── Save Profile
      ├── Outcome
      └── Destination Targeting Ref
                  │
                  ▼
           Maneuver Targeting
```

## Multi-Effect Spell

```text
One Targeting
      │
      ▼
Effect 1
      │
      ▼
Effect 2
      │
      ▼
Effect 3
```

Each Effect owns its own mechanical resolution metadata. WO12 later executes the chain.
