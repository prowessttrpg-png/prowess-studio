/**
 * M5-WO10 final Spell cost policy (authority: designer ruling M5-SC-028; Core Playtest V0.1 s645 TOTAL MP FORMULA and
 * s650 Spell AP). Every program here is an M4 Formula executed only by M4 — the Prowess compiler names its inputs and
 * never performs the arithmetic. Precedent: WO8's TRAIT_PARAMETER_INCREMENT_FORMULA and WO9's CONDITION_POLICY.
 *
 *   contribution — one listed component contribution: max(0, units − includedUnits) × rate (no rounding)
 *   unrounded    — constructed base MP × ONE net cost percentage ÷ 100 (applied once, unrounded)
 *   finalMp      — the ONE final MP rounding: normal rounding, 0.5 up (M5-SC-028). For a non-negative value with at most two
 *                  decimals (base × integer percent ÷ 100) floor(x + 0.5) is exact half-up rounding.
 *   baseAp       — floor(final MP ÷ PRO), minimum 1 (s650: "round down", minimum 1 AP)
 *
 * There is no minimum Spell MP, no maximum Spell AP (3 AP is the turn economy, not a cap) and no Signature discount
 * (no structured authority exists; the older Chapter Book discount is not executable).
 */
export const SPELL_COST_POLICY = {
  fullPricePercent: 100,
  minimumAp: 1,
  formulas: {
    contribution: { expression: "max(0, units - included) * rate", variables: ["units", "included", "rate"] },
    unrounded: { expression: "base * net / 100", variables: ["base", "net"] },
    finalMp: { expression: "floor(unrounded + 0.5)", variables: ["unrounded"] },
    baseAp: { expression: "max(1, floor(final_mp / pro))", variables: ["final_mp", "pro"] },
  },
  authority: ["M5-SC-028", "M5-SC-021", "s645", "s650"],
} as const;
