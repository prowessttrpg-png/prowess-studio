/**
 * PRE-M7-WO1 — Compendium sections: PRESENTATION structure over the existing content model.
 *
 * A section groups existing Definition kinds (and, for content without a Prowess Definition, existing M1 EntityTypes)
 * under a topic a designer recognises. It never creates, renames or redefines a Definition kind, owns no rule and
 * stores nothing: the same exact pinned revision can be reached from several sections (one identity, one owner).
 *
 * `role` says honestly what a section's kinds are to the engine:
 *   - EXECUTABLE  — the kinds carry a supported payload contract that the rules engine reads;
 *   - REFERENCE   — descriptive / reference content (rules text, Keywords, sources) the engine does not execute;
 *   - MIXED       — both kinds of content.
 * `reservedKinds` lists Definition kinds the registry knows but whose payload contract is reserved for a later Work
 * Order: they are shown as "not yet authorable" in that section, never offered as editable mechanics.
 */
export interface CompendiumSection {
  readonly key: CompendiumSectionKey;
  readonly title: string;
  readonly summary: string;
  readonly role: "EXECUTABLE" | "REFERENCE" | "MIXED";
  /** Definition kinds with an active payload contract shown in this section (each kind has exactly one home section). */
  readonly kinds: readonly string[];
  /** Additional sections that cross-link (do not own) these kinds. */
  readonly alsoShows: readonly string[];
  /** Known-but-reserved Definition kinds (no executable payload contract yet). */
  readonly reservedKinds: readonly string[];
  /** Entries WITHOUT a Prowess Definition whose EntityType belongs here (reference content). */
  readonly genericEntityTypes: readonly string[];
}

export const COMPENDIUM_SECTION_KEYS = [
  "gameplay-basics",
  "stats",
  "rules-calculations",
  "combat",
  "creation-progression",
  "skills",
  "magic-abilities",
  "maneuvers",
  "equipment",
  "conditions-effects",
  // RULES-WO1 Phase C: two families that had no home.
  "summons",
  "gm-missions",
  "keywords-references",
] as const;
export type CompendiumSectionKey = (typeof COMPENDIUM_SECTION_KEYS)[number];

const section = (s: CompendiumSection): CompendiumSection => Object.freeze({ ...s, kinds: Object.freeze([...s.kinds]), alsoShows: Object.freeze([...s.alsoShows]), reservedKinds: Object.freeze([...s.reservedKinds]), genericEntityTypes: Object.freeze([...s.genericEntityTypes]) });

export const COMPENDIUM_SECTIONS: readonly CompendiumSection[] = Object.freeze([
  section({
    key: "gameplay-basics",
    title: "Gameplay Basics",
    summary: "Dice, checks and the core procedures every roll uses, plus introductory rules text.",
    role: "MIXED",
    kinds: ["CORE_RESOLUTION", "CHARACTER_DIE_PROGRESSION", "REFERENCE_RULE"], // RULES-WO1: written gameplay tables and rules
    alsoShows: [],
    reservedKinds: [],
    genericEntityTypes: ["GENERIC_RULE", "SYSTEM"],
  }),
  section({
    key: "stats",
    title: "Stats",
    summary: "STR, PER, CON, PRO, AGI and RES: their limits, what they mean and which rules use them.",
    role: "EXECUTABLE",
    kinds: ["STAT"],
    alsoShows: [],
    reservedKinds: [],
    genericEntityTypes: [],
  }),
  section({
    key: "rules-calculations",
    title: "Rules & Calculations",
    summary: "Derived statistics and their formulas — Armor from Strength, Dodge, Maximum HP / MP, Movement and the rest.",
    role: "EXECUTABLE",
    kinds: ["DERIVED_STAT", "CALCULATED_VALUE"], // RULES-WO1: authored calculated values (Carry Capacity …)
    alsoShows: ["CORE_RESOLUTION"],
    reservedKinds: [],
    genericEntityTypes: [],
  }),
  section({
    key: "combat",
    title: "Combat",
    summary: "Actions, Action improvements, resources spent in combat, terrain and creature size.",
    role: "EXECUTABLE",
    kinds: ["ACTION", "ACTION_IMPROVEMENT", "RESOURCE", "TERRAIN", "CREATURE_SIZE"],
    alsoShows: ["ATTACK"],
    reservedKinds: [],
    genericEntityTypes: ["RESOURCE"],
  }),
  section({
    key: "creation-progression",
    title: "Character Creation & Progression",
    summary: "Ancestries, the creation rule, Level advancement and rank ladders.",
    role: "MIXED", // RULES-WO1: Job templates are reference content
    kinds: ["ANCESTRY", "CHARACTER_CREATION_RULE", "CHARACTER_ADVANCEMENT_RULE", "RANK_LADDER", "JOB_TEMPLATE"], // RULES-WO1: optional Job Class templates (reference)
    alsoShows: [],
    reservedKinds: [],
    genericEntityTypes: [],
  }),
  section({
    key: "skills",
    title: "Skills",
    summary: "Skills and what each Skill rank grants.",
    role: "EXECUTABLE",
    kinds: ["SKILL", "SKILL_RANK", "SKILL_BENEFIT"], // RULES-WO1: Skill rank benefits
    alsoShows: ["RANK_LADDER"],
    reservedKinds: [],
    genericEntityTypes: [],
  }),
  section({
    key: "magic-abilities",
    title: "Magic & Abilities",
    summary: "Affinities, ability construction, reusable Spells and the components they are built from, and Mage Arts.",
    role: "MIXED", // PRE-M7-WO1: Mage Arts are reference content (not executed)
    kinds: [
      "AFFINITY",
      "AFFINITY_RANK_RULE",
      "AFFINITY_WEAKNESS_SEVERITY",
      "AFFINITY_PROGRESSION",
      "ABILITY_CONSTRUCTION_RULE",
      "SPELL_DEFINITION",
      "SHARED_TRAIT",
      "SPELL_TARGETING",
      "SPELL_EFFECT",
      "SPELL_TRAIT",
      "SPELL_CASTING_CONDITION",
      "SPELL_DURATION",
      // PRE-M7-WO1: MAGE_ART v1 (authoring and reference; not executable).
      "MAGE_ART",
      // RULES-WO1: Metamagic options and traits (reference).
      "METAMAGIC",
    ],
    alsoShows: [],
    reservedKinds: [],
    genericEntityTypes: ["SPELL_EFFECT", "SPELL_TRAIT", "TARGETING"],
  }),
  section({
    key: "maneuvers",
    title: "Maneuvers",
    summary: "Maneuver components — Foundations, targeting, Effects, Traits, Conditions and durations.",
    role: "EXECUTABLE",
    kinds: ["MANEUVER_DEFINITION", "MANEUVER_FOUNDATION", "MANEUVER_TARGETING", "MANEUVER_EFFECT", "MANEUVER_TRAIT", "MANEUVER_CONDITION", "MANEUVER_DURATION"],
    alsoShows: ["SHARED_TRAIT", "ABILITY_CONSTRUCTION_RULE"],
    reservedKinds: [],
    genericEntityTypes: [],
  }),
  section({
    key: "equipment",
    title: "Equipment",
    summary: "Weapons, their Attacks (movesets) and Equipment Traits.",
    role: "MIXED", // RULES-WO1: worn Armor is reference content (not equipped on the sheet yet)
    kinds: ["WEAPON", "ATTACK", "EQUIPMENT_TRAIT", "ARMOR", "AMMUNITION", "WEAPON_MODIFICATION"], // RULES-WO1: worn Armor, ammunition and modifications (reference and preview)
    alsoShows: [],
    reservedKinds: [],
    genericEntityTypes: [],
  }),
  section({
    key: "conditions-effects",
    title: "Conditions & Ongoing Effects",
    summary: "Status conditions and ongoing effects. The engine's ongoing-effect policies live with the components that use them.",
    role: "REFERENCE",
    kinds: ["CONCENTRATION_RULE", "STATUS_CONDITION"], // RULES-WO1: Concentration (preview) and Conditions (reference)
    alsoShows: ["SPELL_DURATION", "MANEUVER_DURATION", "SPELL_CASTING_CONDITION", "MANEUVER_CONDITION"],
    reservedKinds: [],
    genericEntityTypes: [],
  }),
  section({
    key: "summons",
    title: "Summoning",
    summary: "The Summon engines (Summon Entity, Totem, Persistent Construct, Bound Summon, Manifested Entity, Fusion, Equipment Summoning) and their traits. Reference and cost preview — no Summon is played yet.",
    role: "REFERENCE",
    kinds: ["SUMMON_TYPE", "SUMMON_TRAIT"],
    alsoShows: [],
    reservedKinds: ["SUMMON_ACTION_MODEL"],
    genericEntityTypes: [],
  }),
  section({
    key: "gm-missions",
    title: "GM & Missions",
    summary: "Mission tables, Threat Clocks, Intel and GM reference rules. Reference and table preview — nothing generates a Mission yet.",
    role: "REFERENCE",
    kinds: ["MISSION_RULE"],
    alsoShows: [],
    reservedKinds: [],
    genericEntityTypes: [],
  }),
  section({
    key: "keywords-references",
    title: "Keywords & References",
    summary: "Keyword entries and other reference content cited by the rules.",
    role: "REFERENCE",
    kinds: [],
    alsoShows: [],
    reservedKinds: [],
    genericEntityTypes: ["KEYWORD"],
  }),
]);

export function compendiumSection(key: string): CompendiumSection | null {
  return COMPENDIUM_SECTIONS.find((s) => s.key === key) ?? null;
}

/** The ONE home section of a Definition kind (owner), or null when the kind is not placed. */
export function homeSectionOfKind(kind: string): CompendiumSection | null {
  return COMPENDIUM_SECTIONS.find((s) => s.kinds.includes(kind) || s.reservedKinds.includes(kind)) ?? null;
}

/** Every kind a section shows (owned + cross-linked), in a stable order. */
export function kindsShownInSection(s: CompendiumSection): readonly string[] {
  return [...s.kinds, ...s.alsoShows.filter((k) => !s.kinds.includes(k))];
}

/**
 * The six Stat tokens the Stats section links to (presentation; mirrors @prowess/game PROWESS_STATS — a DB unit test
 * asserts equality so the mirror can never drift). The engine owns what each Stat does; this list only builds links.
 */
export const COMPENDIUM_STAT_TOKENS = Object.freeze(["STR", "AGI", "CON", "PER", "RES", "PRO"] as const);
