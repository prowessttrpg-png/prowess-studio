/**
 * PRE-M7-WO1 — the M5 core Formula variable-source vocabulary, as the authoring catalog serves it.
 *
 * M5 (`@prowess/game`, frozen since M5 certification) keeps these lists internal to `vocabulary/core.ts`
 * (`VARIABLE_SOURCE_KINDS`, `DERIVED_VARIABLE_SOURCE_KINDS`, `RUNTIME_VARIABLE_SOURCE_KINDS`, `CHARACTER_FIELDS`) and does
 * not export them on its public surface. Rather than edit a frozen M5 file, the catalog serves this MIRROR, and the
 * integration gate `pre-m7-wo1-rule-control` (C02) proves it equal to what the M5 DERIVED_STAT reader actually accepts:
 * every listed kind is accepted, and every kind outside the list is refused. A drift in either direction fails CI.
 */
export const FORMULA_SOURCE_KINDS = Object.freeze(["STAT", "CHOSEN_STAT", "CHARACTER", "CHARACTER_DIE_FACES", "DERIVED", "NATURAL", "SKILL_RANK_BONUS", "EXPLICIT_BONUSES", "MOVEMENT_DISTANCE", "CREATURE_SIZE_BASE_MOVEMENT"] as const);
/** The sources a DERIVED_STAT Formula may read (M5 `DERIVED_VARIABLE_SOURCE_KINDS`). */
export const DERIVED_FORMULA_SOURCE_KINDS = Object.freeze(["STAT", "CHARACTER", "CHARACTER_DIE_FACES", "DERIVED", "EXPLICIT_BONUSES", "CREATURE_SIZE_BASE_MOVEMENT"] as const);
/** The Character values a `{ kind: "CHARACTER", field }` source names (M5 `CHARACTER_FIELDS`). */
export const CHARACTER_FIELD_TOKENS = Object.freeze(["LEVEL", "BASE_HP", "BASE_MP"] as const);
