# M5 Final Maneuver Cost, Attack Floors & Signature Reduction (M5-WO11)

Status: implemented locally by M5-WO11 on base `efb4fe7` (the M5-WO10 merge, PR #51). Code:
`packages/prowess-game/src/ability/maneuver-cost.ts`, policy `content/core-playtest-v0.1/maneuver-cost.ts` (pinned in the
versioned `ABILITY_CONSTRUCTION_RULE` as `maneuverCostPolicy`), reader `definition/maneuver-cost-policy.ts`. Gate:
`M5-WO11 audit — Final Maneuver Cost & Attack Floors`.

Authority, in order: designer rulings (M5-SC-025 total Condition discount ≤ 3 AP; M5-SC-026 AP is set by the exact
Attack), CanonDecisions (none relevant), Core Playtest Packet V0.1 "Building a Maneuver" (Base Actions + Maneuver Effects −
Conditions; Minimum AP; Attack Floor; 3 AP Is Not a Cap; Signature Maneuver −1 AP, minimum 1), permanent M5-WO1–WO10
mechanics. WO11 calculates cost. It never executes the Maneuver.

## 1. Final Maneuver Cost Pipeline

```
compile authored Maneuver (WO8, canonical)                       — compileAbilityDefinition
   ↓ validated actions, Effects, Traits, Duration, Conditions (WO5–WO9)
FORMULA  wo11.<m>.contribution.<n>   each exact contribution: max(0, units − included) × rate
MODIFIER wo11.<m>.affinity.<n>       Effect-specific rule: highest relevant Affinity reduction   (only where authored)
FORMULA  wo11.<m>.adjusted.<n>       max(component minimum, amount − reduction)                  (only where authored)
MODIFIER wo11.<m>.base_ap            Base AP  = Σ AP contributions
MODIFIER wo11.<m>.base_mp            Base MP  = Σ MP contributions
FORMULA  wo11.<m>.condition_reduced  Base AP − WO9 EFFECTIVE Condition AP reduction (≤ 3)
FORMULA  wo11.<m>.attack_floor       max(1, separate attack resolutions)
MODIFIER wo11.<m>.post_condition_ap  MAX(Condition-reduced AP, attack floor)
MODIFIER wo11.<m>.final_ap           phase 1 SUBTRACT Signature (1) · phase 2 MAX 1      (no maximum)
MODIFIER wo11.<m>.condition_mp       Σ explicitly selected Condition MP reductions
MODIFIER wo11.<m>.final_mp           phase 1 SUBTRACT Condition MP · phase 2 MAX 0
EXPLANATION wo11.<m>.explanation     every cost step, for the Rules Inspector
```

All arithmetic is M4's. `primaryStepKey` is the final AP step. The request is the authored-Ability request plus
`signatureManeuver: true | false`.

## 2. Base AP

Base AP is the cost before Conditions, Signature Maneuver, items and temporary discounts. It is its own step and its own
result field (`ap.baseApCost`); no later stage overwrites it.

## 3. Base MP

Base MP is the independent sum of exact MP contributions (Effects, Traits, Duration). It is never derived from AP, has no
default and no exchange rate.

## 4. Action / Foundation Aggregation

Each authored action use contributes the exact `costContributions` of its foundation Definition (FIXED AP / MP). A
foundation is either an exact Attack (`rules.attack`, its own weapon profile) or an exact non-attack action (`rules.action`:
`MOVEMENT` / `DEFENSE`, own Targeting, no resolution). A foundation without an authored cost fails closed — nothing is
priced from "Heavy", a weapon or a name (M5-SC-026). Repeated uses of one Attack are distinct contributions.

## 5. Attack Binding And Attachment Scope

A Maneuver selects existing Attacks; each keeps its exact Definition, weapon profile and AP. Each resolution group —
one Attack use, one whole Powerful Blow, or one non-attack action — lists its own Effects and the Traits scoped to those
Effects; Ability-wide Traits are Maneuver-scoped. An Effect attached to more than one resolution, or to only part of a
Powerful Blow, is refused: nothing is broadcast. Each Attack group carries its weapon requirement automatically
(`inheritedRequirements`: no Condition discount, no Condition slot, `REQUIREMENT_CONTRACT_ONLY`); a Condition restating it
(policy `inherentRestrictionKeys`: `WEAPON_LOCK`) is refused (`REDUNDANT_RESTRICTION`).

## 6. Effect Cost Choices

An AP-or-MP alternative is two PER_SELECTION costs (AP and MP) keyed by one TOKEN parameter with no default. The authored
Maneuver must select it explicitly (`MISSING_COST_CHOICE` otherwise); only the selected amounts apply. The Inspector shows
options, amounts per currency and the selection. An AND cost lists both currencies and both apply.

## 7. MP-Bearing Effects

MP exists only where an exact component lists MP. An Effect instance is counted once, however many compiled views contain
it; it is never multiplied by the number of Attacks.

## 8. Effect-Specific Affinity Cost Rules

A FIXED Maneuver Effect cost may declare `affinityReduction` (exact relevant Affinities, per-rank flat reductions,
component minimum). M4 takes the highest owned relevant rank's reduction and applies `max(minimum, amount − reduction)`
once. There is no global Affinity percentage and no Spell Affinity stage. The canonical Elemental Damage Conversion does
not author this rule yet and fails closed (M5-SC-048).

## 9. Condition AP / MP Application

Conditions are WO9's: legality, capacity, choices and listed values are consumed, never revalidated. AP reductions are
consumed only through WO9's effective total. MP reductions are WO9's selected options only.

## 10. Three-AP Condition Cap

WO9's effective step is `min(listed, 3)`. Listed −2 −1 −1 is consumed as −3 (WO9 also keeps that selection INVALID).
Once per Mission −5 AP stays deferred (M5-SC-044).

## 11. Attack-Count Floor

Normal Condition reductions cannot go below `max(1, separate attack resolutions)`.

## 12. Powerful Blow

Powerful Blow combines repeated uses of one exact Attack into one resolution and pays the full sum of their AP. Different
Attacks, or a non-attack action, cannot be combined. It is one resolution for the floor and for attached Effects. It is not
an Effect and takes no Effect slot.

## 13. Signature Maneuver Order

Signature is an explicit assignment; WO5 verifies the slot (`slotUse: DEFAULT`). It reduces post-Condition AP by the
policy's `signatureApReduction` (1) in phase 1 of the final AP step. It is not a Condition, has no slot, sits outside the
cap, may bypass the attack floor and never touches MP. A name never makes a Maneuver a Signature Maneuver.

## 14. Final 1 AP Floor

Phase 2 of the final AP step is MAX 1. A support Maneuver at 0 after Conditions costs 1 AP.

## 15. No 3 AP Maximum

There is no maximum. 3 AP is the turn baseline, not a cost cap; WO11 never rejects a Maneuver for its AP.

## 16. Commitment / Base AP Distinction

Commitment-scaling consumers read `ap.baseApCost`, never `ap.finalApCost`. WO11 rolls no Commitment Die.

## 17. Provenance And Inspector

Every contribution keeps its contribution key, currency, rule, amount, component-use key, exact Definition / EntityVersion,
Ruleset and source-map step. Inspector traces A–J are regenerated by
`packages/prowess-db/tests/unit/m5-wo11-inspector-fixture.test.ts` and run through the existing
`POST /api/rules/evaluate`.

## 18. Historical Reproducibility

Every value comes from the exact materialized Ruleset; an R1 Maneuver keeps its R1 Effect (+1 AP) after R2 publishes
+2 AP; R1 + R2 mixing is refused.

## 19. Unresolved Conflicts

M5-SC-042, M5-SC-044, M5-SC-046 and M5-SC-047 are unchanged. M5-SC-048 (Elemental Damage Conversion MP / relevant
Affinity) is new and fails closed.

## 20. Handoff To WO12

WO12 executes Effect Chains and Maneuver Effect outcomes (attack rolls, Saves, damage, movement) over the attachment
structure WO11 exposes. WO13 owns Sustain, Mana Lock, Concentration and Active Effects. Spending AP / MP is runtime.
