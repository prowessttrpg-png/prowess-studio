# M5-WO8 — Traits and authored Spell/Maneuver definitions

Status: implementation under verification. Local or PR success is not FINAL PASS. Merged-main permanent CI must pass before WO8 completion. The next work order does not start automatically.

## Authority and compatibility

Baseline: `283a7c3f064307d0a2385daf995ad936b2b74e58`, current verified main after WO7 / PR #48. Explicit designer rulings outrank CanonDecisions, current Core Playtest, permanent WO1–WO7 contracts, and superseded Chapter Book material in that order. The WO8 designer selection resolves **M5-SC-041**: three is the base normal Spell Trait cap; explicit approved Effect-slot exchanges may exceed three. The existing Expert three / Master five exchange regressions remain required.

WO5 already authors Maneuver Trait capacities by Martial track. WO8 consumes those exact rows; it does not import Spell capacity or invent a different Maneuver cap. **M5-SC-042** records the missing numeric additional Affinity-specific Trait grant. The result exposes a separate `affinityAdditional` allowance with `capacity: null`; nonempty additional allocations fail closed. An Affinity-specific Trait can occupy an ordinary/exchanged slot when its actual access checks succeed.

Canonical Widen Area comes from the existing M5-SC-024 designer ruling / Core Playtest s825: +5 ft to radius-capable Targeting and +6 MP. It cannot widen Line by treating length as radius. Other neutral Traits in the reference fixtures are test content, not new canonical mechanics. Full Trait catalog authoring remains later content work.

## Storage and exact identity

`SPELL_DEFINITION`, `MANEUVER_DEFINITION`, and `SHARED_TRAIT` extend the permanent Definition-kind inventory. Authored definitions use existing `GENERIC_RULE` EntityVersions; Spell Traits retain `SPELL_TRAIT`; Maneuver/Shared Traits use `GENERIC_RULE`. All use the existing `structuredData.prowessDefinition` envelope and schemaVersion 1. No Prisma schema, migration, repository setting or secret changes are needed.

Every component selection carries all five permanent exact reference fields: entityId, entityVersionId, canonicalKey, definitionKind, systemFamily. A request supplies an exact Ruleset context and materialized bundle. The compiler rebuilds that bundle, checks exact Ruleset provenance, resolves the authored Definition, and validates every selected reference against the pins. There is no latest/current/version fallback. New Trait versions require new dependent authored versions with explicit references; historical releases retain their own objects.

## Trait grammar

The existing common component fields remain: keywords, parameters, compatibility, costContributions and rules. The typed extension lives in `rules.trait`; `rules.construction` remains the permanent prerequisite/stacking/access contract. Legacy WO1 Trait envelopes remain readable; authored WO8 compilation requires typed Trait rules.

| Field | Contract |
|---|---|
| family | SHARED, SPELL or MANEUVER; agrees with the exact Definition kind |
| name / description | Inert display text; never parsed as rules |
| parameters | WO7 COUNT, TOKEN and FLAG schema, with declared bounds/defaults/increments |
| modifications | Closed typed list; no generic executable JSON or independent Effect outcomes |
| effectFamilies | Exact allowed Effect family tokens when applicable |
| foundationCategories | Explicit MELEE/RANGED attack compatibility when applicable |
| incompatibleTraits | Exact canonical Trait keys; no display-name matching |
| affinity | Null or exact Affinity Definition; requires permanent rank prerequisite plus Strength match |

Scope retains permanent vocabulary: `ABILITY_WIDE` is Ability scope, `EFFECT_SPECIFIC` is Effect scope; `TARGETING` and the additive `RESOLUTION` scope select explicit components. Effect and Resolution scopes name the intended Effect instance. Targeting scope names the inherited/selected targeting component. No unselected Effect changes implicitly.

| Modification | Structured behavior |
|---|---|
| DAMAGE_TYPE | Declared TOKEN selection modifies one existing Damage Effect; creates no damage/Condition |
| TARGETING_MEASURE | Declared COUNT plus RADIUS/RANGE/LENGTH/WIDTH and ADD/MULTIPLY/SET; supported numeric base required |
| RESOLUTION | Explicit ATTACK_ROLL, SAVING_THROW or AUTOMATIC; Save mode declares its valid Saves |
| TRIGGER | Explicit supported ON_HIT, ON_MISS, ON_DELIVERY or ON_ENTRY event |
| COST | Declared COUNT plus AP/MP and ADD/MULTIPLY/SET; structural pricing input |

Typed behavior and selections are reported for downstream consumers. WO8 does not run triggers, attacks, Saves, Effects or resource payments. Numeric targeting changes are additionally compiled to M4 MODIFIER steps with the exact base Formula binding and Trait provenance; the result keeps base Targeting and `targetingChanges` separate. Cost contributions reuse WO7 FIXED, PER_UNIT and PER_SELECTION grammar and report selected operands. Final Spell pricing belongs to WO10 and final Maneuver pricing to WO11.

Unknown parameters, explicit null, wrong types/tokens, unsafe JSON and unsupported rule fields fail deterministically. Bounds and increments compile to M4 requirements/formulas. Stacks reuse WO5's fixed/track limits; one selected instance consumes one Trait slot. Repetition on the same target must use declared stacks; separately selected Effects retain distinct Trait slots. Traits cannot author extra damage, healing, summons or Conditions through prose or arbitrary modification data.

Trait access uses `rules.construction` Skill/Affinity prerequisites. Affinity-specific Traits additionally compare their actual Keywords with exact Affinity Strength Keywords through M4 KEYWORD/REQUIREMENT operations. Weakness matches never grant this access. Existing explicit construction access grants remain supported; they cannot bypass the separate Trait Strength validation.

## Authored Spell

A Spell payload contains name, description, a permanent Spell composition, separate `additionalAffinityTraits` allocation keys, and authored `constructionOptions.effectSlotsTradedForTraits` (default zero). Validation cannot override the authored exchange selection. Its composition preserves one canonical Targeting selection and parameters; ordered Effects and parameters; ordered scoped Traits and parameters; Duration; casting restrictions; Keywords; explicit authority; exact Affinity selection; and supported structural chain failure policy.

The compiler never chooses whichever authority yields a legal result. `ARCANE_AUTHORITY` uses permanent Arcane access/capacity; `AFFINITY_AUTHORITY` uses the explicitly selected exact Affinity and profile. WO5 validates capacity, requirements, Signature and exchanges. WO6 validates Targeting and compatibility. WO7 validates each Effect and its scaling/resolution metadata. Empty Effects, missing Targeting, unmet requirements, capacity excess, incompatible delivery, malformed parameters or mixed pins produce typed deterministic failure or an explicit INVALID result.

Duration is an exact component reference. ROUNDS carries a positive integer `rounds`; other supported concepts carry no arbitrary runtime parameters. Every Effect must permit the selected Duration. Sustain/Mana Lock lifecycles and complete chain execution remain deferred; the authored object cannot contain executable branch data.

## Authored Maneuver

A Maneuver payload contains name, description, a composition without Spell-style targeting/branch fields, ordered `actions`, explicit `effectAttachments`, and an optional `powerfulBlow` action group. All component keys and per-slot orders are unique. Every Effect attaches to committed actions; unknown/empty/duplicate attachments fail.

Each exact Maneuver Foundation owns a typed attack profile: category, inherited Targeting, explicit weapon range, attack roll Stat, and weapon damage source (weapon key, base dice, Power, scaling Stat, enchantments). Authored actions cannot override that profile through arbitrary parameters. Normal weapon damage never uses Spell Character Dice. No dice are rolled or damage applied here.

Construction validates every committed action's Foundation prerequisites, including actions without an attached Effect. Global Effect capacity remains one per Martial Rank; stackable Effect instances consume one slot under WO7. Each attached Effect is validated against its action's inherited targeting and explicit Foundation category restrictions. Targeting conversion/Save/cost data stays on the responsible WO7 Effect. Access remains Skill/Martial-based, never class-based.

Powerful Blow is a structural grouping of at least two committed actions, not an Effect. The result identifies combined committed attack damage and attached Effects resolving once. Per-action validation may inspect the same attachment for compatibility, but this is not runtime execution or repeated damage. Actions, their order and attachments remain visible for a future runtime consumer.

## Compilation, Inspector and serialization

`compileAbilityDefinition`, `evaluateAbilityDefinition` and `readAbilityDefinitionRun` are permanent public `@prowess/game` entrypoints. They reuse existing construction/targeting/effect compilers and readers, then assemble a single M4 EvaluationPlan. Every step has an exact source-map entry that also cites the owning authored Definition. M4 computes formula/requirement/keyword/modifier results and the final detailed EXPLANATION document.

Result readers require a complete run with unique exact step identities, operations, orders, successful execution and matching Ruleset provenance. They do not re-evaluate a summary or trust a missing child result. A reader is not a signature verifier for an untrusted remote producer: the application must obtain the run from the M4 engine.

`serializeAuthoredAbilityDefinition` / `deserializeAuthoredAbilityDefinition` validate, detach, normalize and freeze plain JSON. Exact references, parameters, explicit orders and scopes survive round trips. Reordering Effects changes serialized authored meaning. Equal exact inputs yield equal plans/results; no clock, random source, global selection, database access or mutable rules state exists in the domain compiler.

The generated `m5-wo8-ability-plans.json` contains real compiled Spell/Maneuver plans, Trait costs/scopes, attack profiles and exact source maps. A DB unit test regenerates it. API integration sends these plans through existing `/api/rules/evaluate` and verifies detailed Inspector explanations, source identity and no database writes. No new endpoint, visual builder or browser-side mechanics are added.

## Verification and boundaries

Six golden reference objects cover simple/multiple/Affinity Spells and basic/converted/multiple-action Maneuvers. The negative suite explicitly covers all 26 required cases, then unsafe data, parameter nulls, scope leakage, Foundation overrides, undeclared outcomes and forged/partial runs. Real DB integration publishes R1/R2 through normal governance, changes a Trait and dependent authored pins, checks exact historical reproduction and snapshots all persisted tables around evaluation.

M5-I213–I224 extend the invariant catalog. The dedicated WO8 audit checks purity, reuse, exact reference/provenance paths, closed Trait grammar, sibling domain types, capacity separation, action checks and complete result reading. Real source mutations must break the guard and restore byte-for-byte. The WO1 audit's historical component assumptions delegate these specific new modules to this WO8 guard; general package/Canon/source isolation remains enforced across the package.

Permanent CI preserves M0–M4 and WO1–WO7 gates, adds the WO8 gate, and retains Prisma drift, all package/unit/component tests, real DB/API integration, production build and Playwright. The dedicated WO8 workflow adds fast feedback. Neither local nor PR-only green is FINAL PASS; merged-main permanent CI is required.

Out of scope: HP/MP mutation, damage/healing application, battlefield/grid movement, Condition lifecycle, full Effect chain runtime, Counter Actions, Sustain turns, summon AI, visual Spell/Maneuver builders, sheets, cards, campaigns and the next work order.
