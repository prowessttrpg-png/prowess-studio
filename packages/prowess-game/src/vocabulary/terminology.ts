import { deepFreeze } from "../internal/plain-data.js";
import type { ProwessSystemFamily } from "./families.js";

/**
 * Machine-readable Prowess mechanic terminology inventory (PAS-10 M5-WO1 §150–151), built from the Core Playtest
 * source audit (docs/architecture/m5-core-playtest-system-map.md, m5-core-playtest-source-conflicts.md).
 *
 *   CANONICAL        — the term structured M5 content uses
 *   LEGACY           — a historical source term; preserved verbatim in sources and provenance, never used as a
 *                      canonical structured value; `canonicalTerm` names its replacement
 *   UNRESOLVED       — the source uses it inconsistently and no designer / Canon ruling exists; not normalized
 *   SYSTEM_SPECIFIC  — meaningful only inside one system family (e.g. a Maneuver-only concept)
 *
 * This inventory records terminology. It carries no mechanics and is not parsed into rules.
 */
export const TERMINOLOGY_STATUSES = deepFreeze(["CANONICAL", "LEGACY", "UNRESOLVED", "SYSTEM_SPECIFIC"] as const);
export type TerminologyStatus = (typeof TERMINOLOGY_STATUSES)[number];

export const TERMINOLOGY_CATEGORIES = deepFreeze([
  "ABILITY_STAT",
  "SKILL_RANK",
  "RESOURCE",
  "AFFINITY",
  "ABILITY_KIND",
  "TARGETING_SHAPE",
  "EFFECT_FAMILY",
  "TRAIT_FAMILY",
  "CONDITION_FAMILY",
  "RESOLUTION",
  "DURATION",
  "EFFECT_CHAIN",
  "MANEUVER",
  "SUMMON_ACTION_MODEL",
  "SUMMON_TYPE",
  "CORE_RESOLUTION",
  "DERIVED_STAT",
  "ACTION",
  "TACTICAL",
] as const);
export type TerminologyCategory = (typeof TERMINOLOGY_CATEGORIES)[number];

export interface TerminologyEntry {
  /** The term as written (source casing). */
  readonly term: string;
  readonly category: TerminologyCategory;
  readonly status: TerminologyStatus;
  readonly systemFamily: ProwessSystemFamily;
  /** For LEGACY: the canonical replacement. Otherwise null (or the canonical form of a CANONICAL term's token). */
  readonly canonicalTerm: string | null;
  /** The structured token, where one exists (e.g. EVOCATION). */
  readonly token: string | null;
  readonly authority: "DESIGNER_CLARIFICATION" | "CORE_PLAYTEST_V0_1" | "SOURCE_AUDIT";
  readonly conflictKey: string | null;
}

const entry = (
  term: string,
  category: TerminologyCategory,
  status: TerminologyStatus,
  systemFamily: ProwessSystemFamily,
  token: string | null,
  extra: Partial<Pick<TerminologyEntry, "canonicalTerm" | "authority" | "conflictKey">> = {},
): TerminologyEntry => ({
  term,
  category,
  status,
  systemFamily,
  token,
  canonicalTerm: extra.canonicalTerm ?? null,
  authority: extra.authority ?? "CORE_PLAYTEST_V0_1",
  conflictKey: extra.conflictKey ?? null,
});

const C = "CANONICAL" as const;
const L = "LEGACY" as const;
const SS = "SYSTEM_SPECIFIC" as const;
const designer = { authority: "DESIGNER_CLARIFICATION" as const };

export const TERMINOLOGY_INVENTORY: readonly TerminologyEntry[] = deepFreeze([
  // ---- Ability Stats (Core Playtest §ABILITY SCORES) -------------------------------------------------------------
  entry("Strength", "ABILITY_STAT", C, "CHARACTER", "STR"),
  entry("Agility", "ABILITY_STAT", C, "CHARACTER", "AGI"),
  entry("Constitution", "ABILITY_STAT", C, "CHARACTER", "CON"),
  entry("Perception", "ABILITY_STAT", C, "CHARACTER", "PER"),
  entry("Resolve", "ABILITY_STAT", C, "CHARACTER", "RES"),
  entry("Prowess", "ABILITY_STAT", C, "CHARACTER", "PRO"),

  // ---- Core resolution ---------------------------------------------------------------------------------------------
  entry("Character Die", "CORE_RESOLUTION", C, "CORE", "CHARACTER_DIE"),
  entry("Character Dice", "CORE_RESOLUTION", C, "CORE", "CHARACTER_DIE", { conflictKey: "M5-SC-002" }),
  // M5-SC-002 (designer ruling, M5-WO2): "Player Dice / Player Die" is a LEGACY synonym of Character Dice / Die.
  entry("Player Dice", "CORE_RESOLUTION", L, "CORE", null, { ...designer, canonicalTerm: "Character Dice", conflictKey: "M5-SC-002" }),
  entry("Player Die", "CORE_RESOLUTION", L, "CORE", null, { ...designer, canonicalTerm: "Character Die", conflictKey: "M5-SC-002" }),
  entry("Summon Dice", "CORE_RESOLUTION", SS, "SUMMON", "SUMMON_DIE"),
  entry("Bound Dice", "CORE_RESOLUTION", SS, "SUMMON", "BOUND_DIE"),
  entry("Commitment Die", "CORE_RESOLUTION", SS, "MANEUVER", "COMMITMENT_DIE"),
  entry("Character DC", "CORE_RESOLUTION", C, "CORE", "CHARACTER_DC", { conflictKey: "M5-SC-008" }),
  entry("Attack Roll", "RESOLUTION", C, "CORE", "ATTACK_ROLL"),
  entry("Saving Throw", "RESOLUTION", C, "CORE", "SAVING_THROW"),
  entry("Automatic", "RESOLUTION", C, "CORE", "AUTOMATIC"),
  entry("Initiative", "CORE_RESOLUTION", C, "CORE", "INITIATIVE"),
  entry("Critical Hit", "CORE_RESOLUTION", C, "CORE", "CRITICAL_HIT"),
  // M5-SC-010 (designer ruling, M5-WO2): Advantage = max of two naturals, Disadvantage = min; no stacking.
  entry("Advantage", "CORE_RESOLUTION", C, "CORE", "ADVANTAGE", { ...designer, conflictKey: "M5-SC-010" }),
  entry("Disadvantage", "CORE_RESOLUTION", C, "CORE", "DISADVANTAGE", { ...designer, conflictKey: "M5-SC-010" }),
  // M5-SC-005 (designer ruling, M5-WO2): Dodge is canonical; Evasion is its LEGACY name.
  entry("Dodge", "DERIVED_STAT", C, "CHARACTER", "DODGE", { ...designer, conflictKey: "M5-SC-005" }),
  entry("Evasion", "DERIVED_STAT", L, "CHARACTER", null, { ...designer, canonicalTerm: "Dodge", conflictKey: "M5-SC-005" }),
  // M5-SC-009 (designer ruling, M5-WO2): Accuracy is +1 per 3 PRO (content Formula), a named Attack Roll contribution.
  entry("Accuracy", "DERIVED_STAT", C, "CORE", "ACCURACY", { ...designer, conflictKey: "M5-SC-009" }),
  // M5-SC-006 (designer ruling, M5-WO3) as clarified after WO3 (applied in M5-WO4, M5-I111): Base Movement is the
  // creature's authored value (5 ft for the standard character); Movement = Base Movement × AGI. Size-based Base
  // Size Base Movement values: M5-SC-033 / M5-SC-036 (designer rulings, M5-I154).
  entry("Base Movement", "DERIVED_STAT", C, "CHARACTER", "BASE_MOVEMENT", { ...designer, conflictKey: "M5-SC-033" }),
  entry("Movement", "DERIVED_STAT", C, "CHARACTER", "MOVEMENT", { ...designer, conflictKey: "M5-SC-006" }),
  // WO3's interim "Final Movement" name and the "Total Movement" basis question (M5-SC-034) are not statistics (M5-I112).
  entry("Final Movement", "DERIVED_STAT", L, "CHARACTER", null, { ...designer, canonicalTerm: "Movement", conflictKey: "M5-SC-034" }),
  entry("Total Movement", "DERIVED_STAT", L, "CHARACTER", null, { ...designer, canonicalTerm: "Movement", conflictKey: "M5-SC-034" }),

  // ---- Skill ranks ------------------------------------------------------------------------------------------------
  entry("Untrained", "SKILL_RANK", C, "SKILL", "UNTRAINED"),
  entry("Trained", "SKILL_RANK", C, "SKILL", "TRAINED"),
  entry("Expert", "SKILL_RANK", C, "SKILL", "EXPERT"),
  entry("Master", "SKILL_RANK", C, "SKILL", "MASTER"),
  entry("Rank Value", "SKILL_RANK", SS, "MANEUVER", "RANK_VALUE"),
  entry("Rank Bonus", "SKILL_RANK", C, "SKILL", "RANK_BONUS"),
  // M5-SC-011 (post-WO4 designer ruling): Arcane Rank IS the Arcana Skill's rank — one rank, not a separate track.
  // "Arcane Rank" is the canonical term; "Arcana Rank" is its LEGACY spelling.
  entry("Arcane Rank", "SKILL_RANK", C, "SKILL", "ARCANE_RANK", { ...designer, conflictKey: "M5-SC-011" }),
  entry("Arcana Rank", "SKILL_RANK", L, "SKILL", null, { ...designer, canonicalTerm: "Arcane Rank", conflictKey: "M5-SC-011" }),
  entry("Martial Rank", "SKILL_RANK", SS, "MANEUVER", "MARTIAL_RANK"),
  // M5-SC-020 (designer ruling): Summoning Rank Value IS the Summon's Tier (1–4), picked first when building a Summon.
  entry("Summoning Rank Value", "SKILL_RANK", SS, "SUMMON", "SUMMON_TIER", { ...designer, conflictKey: "M5-SC-020" }),

  // ---- Resources --------------------------------------------------------------------------------------------------
  entry("HP", "RESOURCE", C, "RESOURCE", "HP", { conflictKey: "M5-SC-003" }),
  entry("MP", "RESOURCE", C, "RESOURCE", "MP", { conflictKey: "M5-SC-003" }),
  entry("AP", "RESOURCE", C, "ACTION_ECONOMY", "AP"),
  entry("Action Points", "RESOURCE", C, "ACTION_ECONOMY", "AP"),
  entry("Counter Action", "RESOURCE", C, "ACTION_ECONOMY", "COUNTER_ACTION"),
  entry("Mana Efficiency", "RESOURCE", C, "RESOURCE", "ME", { conflictKey: "M5-SC-004" }),
  entry("Mana Points", "RESOURCE", C, "RESOURCE", "MP", { conflictKey: "M5-SC-003" }),
  // M5-WO3: the runtime allowance a Move / Sprint buys; never a change to the Movement statistic (M5-I098).
  entry("Movement Allowance", "RESOURCE", C, "ACTION_ECONOMY", "MOVEMENT_ALLOWANCE", { ...designer }),
  // M5-SC-034 RESOLVED_BY_DESIGNER (applied in M5-WO4): each Sprint grants Movement × 4 (M5-I112).
  entry("Sprint Allowance", "RESOURCE", C, "ACTION_ECONOMY", "SPRINT_ALLOWANCE", { ...designer, conflictKey: "M5-SC-034" }),
  entry("Mana Lock", "RESOURCE", C, "RESOURCE", "MANA_LOCK"),
  entry("Concentration", "RESOURCE", C, "RESOURCE", "CONCENTRATION", { conflictKey: "M5-SC-007" }),
  entry("Signature Ability Slots", "RESOURCE", C, "CHARACTER", "SIGNATURE_ABILITY_SLOTS"),

  // ---- Actions and tactical identities (M5-WO3) — the Dodge ACTION (3 AP) is not the Dodge defense ---------------
  entry("Dodge Action", "ACTION", C, "ACTION_ECONOMY", "DODGE_ACTION"),
  entry("Creature Size", "TACTICAL", C, "CHARACTER", "CREATURE_SIZE", { conflictKey: "M5-SC-033" }),
  entry("Difficult Terrain", "TACTICAL", C, "ACTION_ECONOMY", "DIFFICULT"),

  // ---- Affinities — Evocation is canonical by designer clarification (WO1 §5A); Emission is legacy -----------
  entry("Evocation", "AFFINITY", C, "AFFINITY", "EVOCATION", { authority: "DESIGNER_CLARIFICATION", conflictKey: "M5-SC-001" }),
  entry("Emission", "AFFINITY", L, "AFFINITY", null, { canonicalTerm: "Evocation", authority: "DESIGNER_CLARIFICATION", conflictKey: "M5-SC-001" }),
  entry("Conjuration", "AFFINITY", C, "AFFINITY", "CONJURATION"),
  entry("Transmutation", "AFFINITY", C, "AFFINITY", "TRANSMUTATION"),
  entry("Divination", "AFFINITY", C, "AFFINITY", "DIVINATION"),
  entry("Enhancement", "AFFINITY", C, "AFFINITY", "ENHANCEMENT"),
  entry("Manipulation", "AFFINITY", C, "AFFINITY", "MANIPULATION"),
  // M5-WO4: Affinity structured-rule terms (s118, s161, s624, s680–s687). Tokens name structured concepts only.
  entry("Primary Affinity", "AFFINITY", C, "AFFINITY", "PRIMARY"),
  entry("Secondary Affinity", "AFFINITY", C, "AFFINITY", "SECONDARY"),
  entry("Affinity Rank", "AFFINITY", C, "AFFINITY", "AFFINITY_RANK"),
  entry("Affinity Strength", "AFFINITY", C, "AFFINITY", "AFFINITY_STRENGTH"),
  entry("Affinity Weakness", "AFFINITY", C, "AFFINITY", "AFFINITY_WEAKNESS"),
  entry("Affinity Authority", "AFFINITY", C, "AFFINITY", "AFFINITY_AUTHORITY"),
  entry("Arcane Authority", "AFFINITY", C, "SPELL", "ARCANE_AUTHORITY"),
  entry("Governing Affinity", "AFFINITY", C, "AFFINITY", "GOVERNING_AFFINITY", { ...designer }),
  entry("Affinity Alignment", "AFFINITY", C, "AFFINITY", "AFFINITY_ALIGNMENT", { ...designer }),

  // ---- Ability kinds ----------------------------------------------------------------------------------------------
  entry("Spell", "ABILITY_KIND", C, "ABILITY", "SPELL"),
  entry("Maneuver", "ABILITY_KIND", C, "ABILITY", "MANEUVER"),

  // ---- Targeting semantic shapes ------------------------------------------------------------------------------
  entry("Self", "TARGETING_SHAPE", C, "ABILITY", "SELF"),
  entry("Touch", "TARGETING_SHAPE", C, "ABILITY", "TOUCH"),
  entry("Single Target", "TARGETING_SHAPE", C, "ABILITY", "SINGLE_TARGET"),
  entry("Multi-Target", "TARGETING_SHAPE", C, "ABILITY", "MULTI_TARGET"),
  entry("Sweep / Adjacent Multi-Target", "TARGETING_SHAPE", SS, "MANEUVER", "MULTI_TARGET"),
  entry("Line", "TARGETING_SHAPE", C, "ABILITY", "LINE"),
  entry("Cone", "TARGETING_SHAPE", C, "ABILITY", "CONE"),
  entry("Radius", "TARGETING_SHAPE", C, "ABILITY", "RADIUS", { conflictKey: "M5-SC-015" }),
  entry("Zone", "TARGETING_SHAPE", C, "ABILITY", "ZONE"),
  entry("Aura", "TARGETING_SHAPE", C, "ABILITY", "AURA"),
  entry("Chain", "TARGETING_SHAPE", SS, "MANEUVER", "CHAIN"),
  entry("Trigger-Based", "TARGETING_SHAPE", C, "SPELL", "TRIGGERED"),
  entry("Glyph / Anchor", "TARGETING_SHAPE", C, "SPELL", "ANCHOR"),
  // M5-SC-016 (designer ruling): Projectile is an Attack Roll Targeting Type (with Touch); Line / Cone / Radius / Zone are
  // Saving Throw Targeting Types. Damage works with both groups.
  entry("Projectile", "TARGETING_SHAPE", C, "SPELL", "PROJECTILE", { ...designer, conflictKey: "M5-SC-016" }),
  entry("Summon Point", "TARGETING_SHAPE", SS, "SUMMON", null),

  // ---- Effect families --------------------------------------------------------------------------------------------
  // M5-SC-013 (designer ruling): the Spell branches are Damage, Healing, Buff, Debuff, Control, Utility and Summoning.
  // Cleanse is a sub-branch of Healing and Movement a sub-branch of Utility. M5-SC-037 (designer ruling): Spell
  // Interference is not a branch — it is the ruling Counter Spelling (a Utility mechanic) uses.
  ...["Damage", "Healing", "Buff", "Debuff", "Control", "Utility", "Summoning"].map((t) => entry(t, "EFFECT_FAMILY", SS, "SPELL", t.toUpperCase(), { ...designer, conflictKey: "M5-SC-013" })),
  entry("Cleanse", "EFFECT_FAMILY", SS, "SPELL", "CLEANSE", { ...designer, conflictKey: "M5-SC-013" }),
  entry("Movement", "EFFECT_FAMILY", SS, "SPELL", "MOVEMENT", { ...designer, conflictKey: "M5-SC-013" }),
  entry("Spell Interference", "EFFECT_FAMILY", SS, "SPELL", "SPELL_INTERFERENCE", { ...designer, conflictKey: "M5-SC-037" }),
  ...[
    "Damage / Conversion",
    "Save-Based Attack",
    "Targeting Conversion",
    "Range / Reach",
    "Damage Dice / Commitment",
    "Power / Stat Scaling",
    "Armor / Defense",
    "Control",
    "Martial Condition",
    "Mobility",
    "Guard / Counter",
    "Terrain",
    "Firearm / Engineering",
    "Unarmed / Grapple",
    "Affinity Maneuver",
  ].map((t) => entry(`Maneuver ${t} Effects`, "EFFECT_FAMILY", SS, "MANEUVER", null)),

  // ---- Trait families (Spell only in Core Playtest V0.1) ----------------------------------------------------------
  ...["Damage", "Targeting", "Duration", "Condition", "Control", "Trigger", "Defensive", "Metamagic", "Drawback"].map((t) =>
    entry(`${t} Traits`, "TRAIT_FAMILY", SS, "SPELL", t.toUpperCase()),
  ),
  // M5-SC-017 (designer ruling): Maneuver Traits will exist but none are authored yet; Targeting Conversion is the only
  // way to change a Maneuver's Targeting Type.
  entry("Maneuver Traits", "TRAIT_FAMILY", SS, "MANEUVER", "MANEUVER_TRAIT", { ...designer, conflictKey: "M5-SC-017" }),

  // ---- Ability Condition families ---------------------------------------------------------------------------------
  entry("Casting Condition", "CONDITION_FAMILY", SS, "SPELL", "SPELL_CASTING_CONDITION", { conflictKey: "M5-SC-012" }),
  entry("Casting Components", "CONDITION_FAMILY", SS, "SPELL", null),
  entry("Maneuver Condition", "CONDITION_FAMILY", SS, "MANEUVER", "MANEUVER_CONDITION", { conflictKey: "M5-SC-012" }),
  entry("Martial Condition Effects", "CONDITION_FAMILY", SS, "MANEUVER", null, { conflictKey: "M5-SC-012" }),
  entry("Condition", "CONDITION_FAMILY", C, "CONDITION", "STATUS_CONDITION", { conflictKey: "M5-SC-012" }),

  // ---- Duration concepts ------------------------------------------------------------------------------------------
  ...[
    ["Instant", "INSTANT"],
    ["Rounds", "ROUNDS"],
    ["Combat", "COMBAT"],
    ["Scene", "SCENE"],
    ["Mission", "MISSION"],
    ["Sustained", "SUSTAINED"],
    ["Mana Lock", "MANA_LOCK"],
    ["Permanent", "PERMANENT_BY_SPECIAL_RULE"],
  ].map(([t, k]) => entry(t as string, "DURATION", C, "ABILITY", k as string)),
  entry("Until next turn", "DURATION", SS, "MANEUVER", "UNTIL_NEXT_TURN"),
  entry("Periodic Duration", "DURATION", SS, "SUMMON", null),
  entry("Sustained Manifestation", "DURATION", SS, "SUMMON", null),

  // ---- Effect-chain behaviors (Spell) ---------------------------------------------------------------------------
  ...[
    ["Continue", "CONTINUE"],
    ["Success Only", "SUCCESS_ONLY"],
    ["Failure Only", "FAILURE_ONLY"],
    ["Stop", "STOP"],
    ["Branch", "BRANCH"],
  ].map(([t, k]) => entry(t as string, "EFFECT_CHAIN", SS, "SPELL", k as string, { conflictKey: "M5-SC-014" })),

  // ---- Maneuver concepts --------------------------------------------------------------------------------------------
  entry("Foundation", "MANEUVER", SS, "MANEUVER", "MANEUVER_FOUNDATION"),
  entry("Powerful Blow", "MANEUVER", SS, "MANEUVER", null),
  entry("Save Profile", "MANEUVER", SS, "MANEUVER", null),
  entry("Signature Maneuver", "MANEUVER", SS, "MANEUVER", null),
  entry("Base AP", "MANEUVER", SS, "MANEUVER", null),

  // ---- Summoning -------------------------------------------------------------------------------------------------
  ...["Dependent", "Independent", "Passive", "Template-Based", "Self-Bound", "Split Resource"].map((t) =>
    entry(t, "SUMMON_ACTION_MODEL", SS, "SUMMON", t.toUpperCase().replace(/[ -]/g, "_"), t === "Dependent" || t === "Independent" ? { conflictKey: "M5-SC-019" } : {}),
  ),
  ...["Entity", "Totem", "Bound", "Construct", "Manifested Entity", "Fusion", "Structure", "Gear", "Glyph", "Vehicle"].map((t) =>
    entry(t, "SUMMON_TYPE", SS, "SUMMON", t.toUpperCase().replace(/ /g, "_")),
  ),
]);

/**
 * The LEGACY entry `candidate` names, or null. Case-insensitive on the whole term, and spaces, hyphens and underscores
 * are one separator — so "Emission", "EMISSION", "Player Die" and "PLAYER_DIE" are all recognised.
 */
const termToken = (value: string): string => value.toUpperCase().replace(/[ _-]+/g, "_");
export function legacyTermFor(candidate: string): { term: string; canonicalTerm: string } | null {
  const hit = TERMINOLOGY_INVENTORY.find((e) => e.status === "LEGACY" && termToken(e.term) === termToken(candidate));
  return hit === undefined || hit.canonicalTerm === null ? null : { term: hit.term, canonicalTerm: hit.canonicalTerm };
}
