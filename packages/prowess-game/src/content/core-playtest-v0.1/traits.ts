/** WO8: explicit designer ruling M5-SC-024, source s825. Full Trait catalog remains content-authoring work. */
export const WIDEN_AREA_TRAIT_CONTENT = {
  canonicalKey: "spell.trait.widen_area", definitionKind: "SPELL_TRAIT",
  payload: {
    traitFamily: "AREA_MODIFICATION", scope: "TARGETING", keywords: ["keyword.area_effect"], parameters: {},
    compatibility: [], costContributions: [{ contributionKey: "trait.widen_area.mp", currency: "MP", data: { kind: "FIXED", amount: 6 } }],
    rules: {
      construction: { prerequisites: [], stacking: { stackable: false }, affinityAccess: [] },
      trait: { family: "SPELL", name: "Widen Area", description: "Increase the area of a radius-capable Targeting Type by 5 ft. M5-SC-024; Core Playtest s825.",
        parameters: [{ parameter: "feet", kind: "COUNT", minimum: 5, maximum: { kind: "FIXED", value: 5 }, increment: 5, default: 5 }],
        modifications: [{ kind: "TARGETING_MEASURE", parameter: "feet", measure: "RADIUS", operation: "ADD" }],
        effectFamilies: [], foundationCategories: [], incompatibleTraits: [], affinity: null },
    },
  },
} as const;
/** Shared parameter-step validation math is authored here and executed only by M4. */
export const TRAIT_PARAMETER_INCREMENT_FORMULA = "value - minimum - floor((value - minimum) / increment) * increment";
