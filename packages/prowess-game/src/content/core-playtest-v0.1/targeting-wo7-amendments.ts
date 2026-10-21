/** M5-WO7 current-canon Targeting amendments. WO6 targeting.json remains an immutable historical fixture. */
export const TARGETING_WO7_AMENDMENTS = {
  contentKey: "prowess.core_playtest.v0_1.targeting.m5_wo7_amendments",
  workOrder: "M5-WO7",
  sourceAuthority: ["M5-SC-039 RESOLVED_BY_DESIGNER", "M5-SC-040 RESOLVED_BY_DESIGNER"],
  supersedesCurrentCanonOnly: ["M5-I160", "M5-I163", "M5-I167"],
  definitions: [
    {
      canonicalKey: "spell.targeting.projectile",
      definitionKind: "SPELL_TARGETING",
      schemaVersion: 1,
      payload: {
        semanticShape: "PROJECTILE", geometry: {}, keywords: [], parameters: {}, compatibility: [],
        costContributions: [
          { contributionKey: "targeting.base", currency: "MP", data: { kind: "BASE", amount: 3 } },
          { contributionKey: "targeting.range_extension", currency: "MP", data: { kind: "PER_STEP", parameter: "rangeExtension", amount: 2, step: { size: 15, unit: "ft" } } },
        ],
        rules: {
          targeting: {
            deliveryFamily: "DIRECT_ATTACK_DELIVERY", cardinality: { kind: "ONE" }, validTargets: ["CREATURE", "OBJECT", "POINT"],
            range: { model: "DEFAULT_SPELL_RANGE", formula: { expression: "base_range + range_extension * 15", rounding: "NONE", unit: "ft", variables: [{ variable: "base_range", source: { kind: "DERIVED", statistic: "BASE_RANGE" } }, { variable: "range_extension", source: { kind: "PARAMETER", parameter: "rangeExtension" } }] } },
            measures: [], origin: { modes: ["CASTER"], default: "CASTER" }, placement: "CHOOSE_TARGETS", lineOfSight: "REQUIRED", lineOfEffect: "REQUIRED", cover: "EXPOSED_TO_RESOLUTION", radiusCapable: false,
            parameters: [{ parameter: "rangeExtension", kind: "STEPS", minimum: 0, default: 0 }],
          },
          delivery: { check: "RANGED_ATTACK_ROLL" },
        },
      },
    },
    {
      canonicalKey: "spell.targeting.line",
      definitionKind: "SPELL_TARGETING",
      schemaVersion: 1,
      payload: {
        semanticShape: "LINE", geometry: {}, keywords: [], parameters: {}, compatibility: [],
        costContributions: [
          { contributionKey: "targeting.base", currency: "MP", data: { kind: "BASE", amount: 5 } },
          { contributionKey: "targeting.line_length_extension", currency: "MP", data: { kind: "PER_STEP", parameter: "lengthExtension", amount: 3, step: { size: 10, unit: "ft" } } },
          { contributionKey: "targeting.line_width_extension", currency: "MP", data: { kind: "PER_STEP", parameter: "widthExtension", amount: 4, step: { size: 5, unit: "ft" } } },
        ],
        rules: {
          targeting: {
            deliveryFamily: "AREA_DELIVERY", cardinality: { kind: "AREA" }, validTargets: ["CREATURE", "OBJECT", "AREA"], range: { model: "SELF" },
            measures: [
              { measure: "LENGTH", valueStatus: "FORMULA", formula: { expression: "10 * pro + length_extension * 10", rounding: "NONE", unit: "ft", variables: [{ variable: "pro", source: { kind: "STAT", stat: "PRO" } }, { variable: "length_extension", source: { kind: "PARAMETER", parameter: "lengthExtension" } }] } },
              { measure: "WIDTH", valueStatus: "FORMULA", formula: { expression: "5 * ceil(pro / 2) + width_extension * 5", rounding: "NONE", minimum: 5, unit: "ft", variables: [{ variable: "pro", source: { kind: "STAT", stat: "PRO" } }, { variable: "width_extension", source: { kind: "PARAMETER", parameter: "widthExtension" } }] } },
            ],
            origin: { modes: ["CASTER"], default: "CASTER" }, placement: "FROM_ORIGIN", lineOfSight: "REQUIRED", lineOfEffect: "REQUIRED", cover: "EXPOSED_TO_RESOLUTION", radiusCapable: false,
            parameters: [{ parameter: "lengthExtension", kind: "STEPS", minimum: 0, default: 0 }, { parameter: "widthExtension", kind: "STEPS", minimum: 0, default: 0 }],
          },
        },
      },
    },
  ],
} as const;
