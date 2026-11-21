/**
 * RULES-WO1 — what the application ACTUALLY does with each Definition kind, for the truthful status indicators on every
 * entry page and the coverage matrix. This is a code-declared, test-pinned registry: a kind's `execution` says whether a
 * runtime reads it (LIVE), reads part of it (PARTIAL) or only shows it as reference (REFERENCE_ONLY); `consumers` names
 * the screens / engines that read it; `preview` names the preview the Studio offers for a Draft. Authoring support
 * (guided editor, validation) is separate and is derived from the catalog and the Studio descriptors — a guided editor
 * never implies live execution.
 */
export type KindExecution = "LIVE" | "PARTIAL" | "REFERENCE_ONLY";
export type KindPreview = "RULE_PREVIEW" | "AUTHORED_RULE" | "REFERENCE_PREVIEW" | "CONTENT";
export interface KindCapability {
  readonly execution: KindExecution;
  readonly consumers: readonly string[];
  readonly preview: KindPreview;
  /** What is NOT live yet, in plain words (empty when fully live). */
  readonly notYet: string;
}

const live = (consumers: string[], preview: KindPreview = "CONTENT"): KindCapability => ({ execution: "LIVE", consumers, preview, notYet: "" });
const partial = (consumers: string[], notYet: string, preview: KindPreview = "CONTENT"): KindCapability => ({ execution: "PARTIAL", consumers, preview, notYet });
const reference = (notYet: string, preview: KindPreview = "CONTENT"): KindCapability => ({ execution: "REFERENCE_ONLY", consumers: ["Rules Reference"], preview, notYet });

export const KIND_CAPABILITIES: Readonly<Record<string, KindCapability>> = Object.freeze({
  CORE_RESOLUTION: live(["Character sheet (saves, Initiative)", "Play (rolls)"], "RULE_PREVIEW"),
  CHARACTER_DIE_PROGRESSION: live(["Character creation", "Advancement", "Character sheet"]),
  STAT: live(["Character creation", "Character sheet", "every rule that reads a Stat"], "RULE_PREVIEW"),
  DERIVED_STAT: live(["Character sheet", "Play"], "RULE_PREVIEW"),
  CALCULATED_VALUE: partial(["Character sheet (Carry maximum, Additional Values)"], "Combat and play do not read calculated values yet.", "AUTHORED_RULE"),
  SKILL_BENEFIT: partial(["Character sheet (value additions)"], "Granted Actions are listed but not yet added to the Character's actions; a benefit with further prerequisites is not applied on the sheet yet.", "AUTHORED_RULE"),
  CONCENTRATION_RULE: reference("Combat and Active Magic do not use this rule yet; they still use the earlier Concentration policy.", "AUTHORED_RULE"),
  RANK_LADDER: live(["Character creation", "Advancement", "Character sheet"]),
  SKILL_RANK: live(["Character sheet (Skill scores)", "Play (Skill checks)"]),
  SKILL: live(["Character creation", "Advancement", "Character sheet"]),
  ANCESTRY: live(["Character creation"]),
  CHARACTER_CREATION_RULE: live(["Character creation"]),
  CHARACTER_ADVANCEMENT_RULE: live(["Advancement"]),
  JOB_TEMPLATE: reference("Character creation does not offer Job templates yet (they are optional rules)."),
  CREATURE_SIZE: partial(["Play (space and movement)"], "Massive's movement adjustment is pending canon."),
  RESOURCE: live(["Character sheet (resources)", "Play"]),
  ACTION: live(["Play", "Action cards"]),
  ACTION_IMPROVEMENT: live(["Action cards", "Character access"]),
  TERRAIN: partial(["Play (movement cost)"], "Hazard effects are not applied."),
  AFFINITY: live(["Character creation", "Advancement", "Spell builder"]),
  AFFINITY_RANK_RULE: live(["Advancement", "Spell builder"]),
  AFFINITY_WEAKNESS_SEVERITY: reference("A reference scale only."),
  AFFINITY_PROGRESSION: live(["Advancement"]),
  ABILITY_CONSTRUCTION_RULE: live(["Signature Spell and Maneuver builders", "Play (Active Magic)"]),
  SPELL_DEFINITION: live(["Spell builder", "Play"]),
  SHARED_TRAIT: live(["Spell and Maneuver builders"]),
  SPELL_TARGETING: live(["Spell builder", "Play"]),
  SPELL_EFFECT: live(["Spell builder", "Play"]),
  SPELL_TRAIT: live(["Spell builder", "Play"]),
  SPELL_CASTING_CONDITION: live(["Spell builder"]),
  SPELL_DURATION: live(["Spell builder", "Play (Active Magic)"]),
  METAMAGIC: reference("The Spell builder does not offer Metamagic yet."),
  MANEUVER_DEFINITION: live(["Maneuver builder", "Play"]),
  MANEUVER_TARGETING: live(["Maneuver builder", "Play"]),
  MANEUVER_EFFECT: live(["Maneuver builder", "Play"]),
  MANEUVER_TRAIT: live(["Maneuver builder", "Play"]),
  MANEUVER_CONDITION: live(["Maneuver builder"]),
  MANEUVER_DURATION: live(["Maneuver builder"]),
  MANEUVER_FOUNDATION: live(["Maneuver builder", "Weapon bridge"]),
  MAGE_ART: reference("Nothing plays a Mage Art yet; its card shows as unavailable."),
  WEAPON: live(["Weapon library", "Character sheet (equipment)", "Play"]),
  ATTACK: live(["Weapon library", "Play"]),
  EQUIPMENT_TRAIT: live(["Weapon library"]),
  ARMOR: reference("The Character sheet does not equip worn Armor yet.", "REFERENCE_PREVIEW"),
  STATUS_CONDITION: reference("Play does not apply Conditions yet."),
  SUMMON_TYPE: reference("No Summon is created or played yet.", "REFERENCE_PREVIEW"),
  SUMMON_TRAIT: reference("No Summon is created or played yet."),
  SUMMON_ACTION_MODEL: reference("Reserved: the action economy is written on each Summon engine."),
  MISSION_RULE: reference("Nothing generates or runs a Mission yet.", "REFERENCE_PREVIEW"),
  REFERENCE_RULE: reference("A written gameplay rule (table or points) for players and GMs; nothing calculates from it.", "REFERENCE_PREVIEW"),
});

export function capabilityOf(kind: string): KindCapability {
  return KIND_CAPABILITIES[kind] ?? reference("Not yet described.");
}
