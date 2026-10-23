# M5 Final Spell Cost, Percentage Netting & AP Derivation (M5-WO10)

Status: implemented locally by M5-WO10 on base `d5c0f6c` (the M5-WO9 merge, PR #50). Code:
`packages/prowess-game/src/ability/spell-cost.ts`, policy `content/core-playtest-v0.1/spell-cost.ts`. Gate:
`M5-WO10 audit — Final Spell Cost & AP Derivation`.

## 1. Scope

WO10 answers, for one exact authored Spell under one exact Ruleset: the constructed base MP, which component contributed
each value, which percentage modifiers apply, the ONE net percentage, the unrounded final MP, the final rounded MP, the base
Spell AP derived from final MP and PRO, the explicit AP modifiers and the final AP — each with exact provenance. WO10
calculates cost. It does not cast, spend, reserve or execute anything.

## 2. Source Authority

1. Designer rulings — M5-SC-028 (one net percentage, normal rounding once at the end) and M5-SC-021 (flat 30% Casting
   Condition cap). 2. CanonDecisions (none relevant). 3. Core Playtest V0.1 — s645 TOTAL MP FORMULA, s650 Spell AP (round
   down, minimum 1). 4. Permanent M5-WO1–WO9 structured mechanics. 5. Older Chapter Book material is not promoted (M5-SC-047).

## 3. Final Spell MP Pipeline

```
compile authored Spell (WO8, canonical)                      — compileAbilityDefinition
   ↓ validated component outputs (WO4 / WO6 / WO7 / WO8 / WO9)
FORMULA  wo10.<spell>.contribution.<n>   each listed contribution: max(0, units − included) × rate
MODIFIER wo10.<spell>.base_mp            constructed base MP: ADD each MP contribution, SUBTRACT exact flat reductions
MODIFIER wo10.<spell>.net_percent        ONE net percentage: 100 − Strength + Weakness − effective Conditions
FORMULA  wo10.<spell>.unrounded_mp       base × net ÷ 100   (applied ONCE, unrounded)
REQUIREMENT wo10.<spell>.non_negative    negative final MP fails closed (never clamped)
FORMULA  wo10.<spell>.final_mp           floor(unrounded + 0.5)   ← the ONE rounding (normal, 0.5 up)
FORMULA  wo10.<spell>.base_ap            max(1, floor(final_mp / pro))
MODIFIER wo10.<spell>.final_ap           explicit AP modifiers, then MAX 1 (no maximum)
EXPLANATION wo10.<spell>.explanation     every cost step, for the Rules Inspector
```

All arithmetic is M4's. `finalMpCost` is the authoritative Spell MP Cost for later systems.

## 4. Component Aggregation

| Source | Consumed output | Rule |
|---|---|---|
| Targeting (WO6) | `targeting.outputs.cost` — LISTED base, PER_STEP, PER_SELECTION | BASE_DEFERRED and selected PER_ADDITIONAL_TARGET fail closed (M5-SC-046) |
| Effects (WO7) | each Effect plan's `costContributions` with the use's selection | FIXED, PER_UNIT (− included units), PER_SELECTION |
| Traits (WO8) | each compiled Trait's `costs`; an exact `COST`/`ADD` modification of a selected count | `COST` MULTIPLY / SET have no authored Spell-cost meaning → fail closed |
| Duration (WO9) | the WO9 listed-value steps (never recomputed) | UNLISTED Durations contribute nothing |
| Casting Conditions (WO9) | MP_REDUCTION (flat, subtracted from base), AP_REDUCTION / AP_COMMITMENT (AP stage) | MP_PERCENT_REDUCTION is consumed only through the WO9 effective cap |

Each contribution is identified by source, component key and contribution key; a duplicate identity fails closed
(`DUPLICATE_CONTRIBUTION`). Nothing is priced from prose, names or geometry.

## 5. Percentage Netting (M5-SC-028)

ALL percentage modifiers combine into ONE net percentage (100 = full price) in one M4 MODIFIER, then apply once. Sequential
application (base → Affinity → round → Weakness → round → Conditions → round) is never compiled. Example: Strength −20%,
Weakness +10%, Verbal −10% → net 80% → 20 MP → 16 MP (never 20 × .8 × 1.1 × .9 = 15.84). The structured modifier operation
(SUBTRACT / ADD), not a label, owns the sign.

## 6. M5-SC-021 Interaction

The Casting Condition percentage is the WO9 EFFECTIVE reduction — `min(listed, 30)` — bound from WO9's
`spellMpPercent.effectiveStep`. Listed −10% −15% −20% = 45% is consumed as −30%. No rank-based 20 / 30 / 40% cap exists.

## 7. Affinity Reuse (WO4)

WO10 calls `compileAffinity` with the SPELL_AFFINITY_COST subject and includes its keyword, Strength, Weakness and
Weakness-selection steps. The WO4 net-percentage modifiers (Strength SUBTRACT the exact rank discount; Weakness ADD the M4-
selected highest Weakness) are re-hosted verbatim inside the single Spell net percentage. The WO4 listed-cost step
(× net ÷ 100) and the WO4 net step are never part of the Spell cost plan, so Affinity is consumed exactly once and
`affinityAdjustedCost` is never re-applied. Strength discounts: Trained 10%, Expert 20%, Master 30% (the WO4 rank rule).

## 8. Final MP Rounding

One FORMULA, role `spell-final-mp-rounding`: `floor(unrounded + 0.5)` — normal rounding, 0.5 up, for the non-negative
value `base × integer percent ÷ 100` (at most two decimals; the .5 case is exact). 13.4 → 13, 13.5 → 14, 13.6 → 14. No
component, Affinity stage or Condition stage rounds; every other WO10 FORMULA declares `rounding: NONE`. The legacy example
13 × 0.9 = 11.7 → 11 is historical source material; current executable behaviour gives 12 MP.

## 9. AP Derivation

Base AP = `max(1, floor(final MP ÷ PRO))`, bound only to the final MP step. PRO is the caster's exact Prowess Score from the
WO2 character contract; missing, zero or non-integer PRO is refused (`INVALID_PRO`) — never defaulted or inferred.

## 10. AP Modifier Ordering

After base AP: Somatic −1 AP, Charge +N AP, exact AP contributions of Effects / Traits / Duration; then MAX 1. 17 MP at
PRO 4 → 4 AP → Somatic → 3 AP. 2 MP at PRO 5 → 0 → 1 → Somatic cannot go below 1. 36 MP at PRO 5 → 7 AP: there is no 3 AP
maximum. Charge's −10% per extra AP joins the net percentage; its +N AP applies after base AP.

## 11. ME Boundary

Mana Efficiency is payment capacity, never a discount. No ME input exists in the Spell cost contract; 12 MP stays 12 MP
whatever ME the caster has. Payment ("ME first, then MP") is later runtime.

## 12. Mana Lock Boundary

A MANA_LOCK Spell receives a final constructed MP value; reserving, reducing or restoring Maximum MP is WO13.

## 13. Channeling Boundary

A Spell whose AP exceeds the turn economy is reported as is (e.g. 7 AP). Splitting AP across rounds, accumulation,
interruption and Concentration are not executed (WO13).

## 14. Sustain Boundary

No Sustain payment, AP, ME, Concentration or termination is executed (WO13).

## 15. Historical Reproducibility

Every contribution comes from the exact materialized Ruleset; there is no latest / current lookup. An R1 Spell keeps its R1
Trait (+2 MP) after R2 publishes +4 MP; a Spell compiled against another Ruleset's bundle is refused.

## 16. Inspector / Source Map

Every WO10 step has a source-map entry naming the Spell and the exact contributing Definitions; the M4 MODIFIER outcomes show
each stage (`before` / `after`) of the base and the net percentage; an EXPLANATION step covers every cost step. Traces A–H
(simple, Affinity-aligned, Strength + Weakness, Casting Condition, Affinity + Conditions, Somatic, Charge, high-AP) are
regenerated by `packages/prowess-db/tests/unit/m5-wo10-inspector-fixture.test.ts` and run through the existing
`POST /api/rules/evaluate`.

Example — "Why is this Spell 16 MP?" Targeting +3 · Effect +17 → base 20 · Strength −20% · Weakness +10% · Conditions −10% →
net 80% → unrounded 16 → final 16 MP · PRO 4 → base AP 4 → final 4 AP.

## 17. Unresolved Legacy Modifiers

- Signature Spell MP discount — older Chapter Book only; no structured authority (M5-SC-047). Not applied; no name-based shortcut.
- Multi-Target additional-target base count — unauthored (M5-SC-046). Fails closed.
- Trait `COST` MULTIPLY / SET — no authored meaning for total Spell cost. Fails closed.
- M5-SC-042 additional Affinity Trait capacity — still unresolved; still refused by WO8.
- Dynamic Metamagic (Quickened, Twin, Overchannel, Channel, Reactive) — not implemented.

## 18. Handoff To WO11–WO13

- **WO11** — final Maneuver cost (Base Actions + Maneuver Effects − Conditions, floors, Signature behaviour). WO10 refuses
  Maneuvers with `SPELL_ONLY`.
- **WO12** — Effect Chain execution.
- **WO13** — Sustain, Mana Lock lifecycle, Concentration, Channeling runtime, Active Effects; consumes `finalMpCost` /
  `finalApCost`.

## 19. Invariants

M5-I243 · M5-I244 · M5-I245 · M5-I246 · M5-I247 · M5-I248 · M5-I249 · M5-I250 · M5-I251 · M5-I252 · M5-I253 · M5-I254 ·
M5-I255 · M5-I256 · M5-I257 · M5-I258 · M5-I259 · M5-I260.
