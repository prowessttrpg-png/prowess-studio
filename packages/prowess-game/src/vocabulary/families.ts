import type { EntityType } from "@prowess/model";
import { deepFreeze } from "../internal/plain-data.js";

/**
 * Stable Prowess vocabulary (PAS-10 M5-WO1 §81–83). Every list is closed, deep-frozen and declared exactly once.
 * Nothing in @prowess/game infers a family, kind or branch from the shape of a value: each is an explicit field.
 */

/**
 * High-level Prowess system families, from the Core Playtest system map (docs/architecture/m5-core-playtest-system-map.md).
 * A family groups Definition kinds; it is not a Definition kind and carries no mechanics.
 */
export const PROWESS_SYSTEM_FAMILIES = deepFreeze([
  "CORE",
  "CHARACTER",
  "ANCESTRY",
  "SKILL",
  "RESOURCE",
  "ACTION_ECONOMY",
  "AFFINITY",
  "ABILITY",
  "SPELL",
  "MANEUVER",
  "MAGE_ART",
  "EQUIPMENT",
  "SUMMON",
  "CONDITION",
  "MISSION",
] as const);
export type ProwessSystemFamily = (typeof PROWESS_SYSTEM_FAMILIES)[number];

/** The explicit Ability Construction branches (§23). AbilityKind is always authored, never inferred. */
export const ABILITY_KINDS = deepFreeze(["SPELL", "MANEUVER"] as const);
export type AbilityKind = (typeof ABILITY_KINDS)[number];

/**
 * The SHARED structural contracts of Ability Construction (§22, §83). A Definition kind may implement one of these;
 * implementing the same contract never makes two kinds interchangeable (M5-I038).
 */
export const ABILITY_COMPONENT_CONTRACTS = deepFreeze(["TARGETING", "EFFECT", "TRAIT", "DURATION", "ABILITY_CONDITION", "FOUNDATION"] as const);
export type AbilityComponentContract = (typeof ABILITY_COMPONENT_CONTRACTS)[number];

/**
 * Every Prowess Definition kind, with its family, Ability branch, shared contract, the existing M1 EntityTypes it may
 * be stored under, and the payload schema versions this build understands.
 *
 * Storage (M5-WO1 §232 — no schema change): the M1 `EntityType` enum is a coarse STORAGE classification that predates
 * M5. The Prowess DefinitionKind lives in the EntityVersion's structured envelope and is the semantic identity. Where
 * M1 already has a matching type (SPELL_EFFECT, SPELL_TRAIT, TARGETING, RESOURCE) that type is required; every other
 * kind is stored as GENERIC_RULE. Two kinds sharing an EntityType (SPELL_TARGETING / MANEUVER_TARGETING → TARGETING)
 * remain different Definition kinds.
 *
 * `schemaVersions: []` marks a kind as KNOWN but RESERVED: its payload contract belongs to a later M5 Work Order, so an
 * envelope of that kind is rejected as UNSUPPORTED_SCHEMA_VERSION rather than accepted with a guessed shape.
 */
export interface DefinitionKindSpec {
  readonly family: ProwessSystemFamily;
  readonly branch: AbilityKind | null;
  readonly contract: AbilityComponentContract | null;
  readonly entityTypes: readonly EntityType[];
  readonly schemaVersions: readonly number[];
}

const reserved = (family: ProwessSystemFamily, entityTypes: readonly EntityType[] = ["GENERIC_RULE"]): DefinitionKindSpec => ({
  family,
  branch: null,
  contract: null,
  entityTypes,
  schemaVersions: [],
});
/** A non-Ability kind with a version-1 payload contract (M5-WO2 core kinds, M5-WO3 runtime kinds). */
const active = (family: ProwessSystemFamily, entityTypes: readonly EntityType[] = ["GENERIC_RULE"]): DefinitionKindSpec => ({ family, branch: null, contract: null, entityTypes, schemaVersions: [1] });
const component = (family: "SPELL" | "MANEUVER", contract: AbilityComponentContract, entityTypes: readonly EntityType[]): DefinitionKindSpec => ({
  family,
  branch: family,
  contract,
  entityTypes,
  schemaVersions: [1],
});

const DEFINITION_KIND_TABLE = {
  // Core resolution / character core / rank primitives — v1 payloads defined by M5-WO2 (definition/core-payload.ts).
  CORE_RESOLUTION: active("CORE"),
  CHARACTER_DIE_PROGRESSION: active("CORE"),
  STAT: active("CHARACTER"),
  DERIVED_STAT: active("CHARACTER"),
  RANK_LADDER: active("SKILL"),
  SKILL_RANK: active("SKILL"),
  // Ancestry / Skill catalogs — known, reserved for a later M5 Work Order.
  ANCESTRY: reserved("ANCESTRY"),
  SKILL: reserved("SKILL"),
  // Runtime resources, the action catalog and the tactical movement identities — v1 payloads defined by M5-WO3
  // (definition/runtime-payload.ts). RESOURCE keeps the M1 RESOURCE storage type it was reserved under in WO1.
  RESOURCE: active("RESOURCE", ["RESOURCE"]),
  ACTION: active("ACTION_ECONOMY"),
  /** A creature Size's tactical identity: occupied space only — its movement adjustment is pending canon (M5-SC-033). */
  CREATURE_SIZE: active("CHARACTER"),
  /** A terrain kind's Movement-allowance cost (Difficult Terrain, s439). Hazard effects are later Effect / Condition work. */
  TERRAIN: active("ACTION_ECONOMY"),

  // Affinity — WO1 owns only its canonical identity (Evocation, never Emission); rules arrive in M5-WO4.
  AFFINITY: { family: "AFFINITY", branch: null, contract: null, entityTypes: ["GENERIC_RULE"], schemaVersions: [1] },

  // Spell branch — separate canonical catalogs implementing the shared contracts.
  SPELL_TARGETING: component("SPELL", "TARGETING", ["TARGETING"]),
  SPELL_EFFECT: component("SPELL", "EFFECT", ["SPELL_EFFECT"]),
  SPELL_TRAIT: component("SPELL", "TRAIT", ["SPELL_TRAIT"]),
  SPELL_CASTING_CONDITION: component("SPELL", "ABILITY_CONDITION", ["GENERIC_RULE"]),
  SPELL_DURATION: component("SPELL", "DURATION", ["GENERIC_RULE"]),

  // Maneuver branch — same contracts, different catalogs.
  MANEUVER_TARGETING: component("MANEUVER", "TARGETING", ["TARGETING"]),
  MANEUVER_EFFECT: component("MANEUVER", "EFFECT", ["GENERIC_RULE"]),
  MANEUVER_TRAIT: component("MANEUVER", "TRAIT", ["GENERIC_RULE"]),
  MANEUVER_CONDITION: component("MANEUVER", "ABILITY_CONDITION", ["GENERIC_RULE"]),
  MANEUVER_DURATION: component("MANEUVER", "DURATION", ["GENERIC_RULE"]),
  MANEUVER_FOUNDATION: { family: "MANEUVER", branch: "MANEUVER", contract: "FOUNDATION", entityTypes: ["GENERIC_RULE"], schemaVersions: [] },

  // Later families — known, reserved.
  MAGE_ART: reserved("MAGE_ART"),
  WEAPON: reserved("EQUIPMENT"),
  ARMOR: reserved("EQUIPMENT"),
  EQUIPMENT_TRAIT: reserved("EQUIPMENT"),
  SUMMON_TYPE: reserved("SUMMON"),
  SUMMON_TRAIT: reserved("SUMMON"),
  SUMMON_ACTION_MODEL: reserved("SUMMON"),
  /** A state applied TO a target (Burning, Prone …) — never an Ability Condition (M5-I040). */
  STATUS_CONDITION: reserved("CONDITION"),
  MISSION_RULE: reserved("MISSION"),
} as const satisfies Record<string, DefinitionKindSpec>;

export type ProwessDefinitionKind = keyof typeof DEFINITION_KIND_TABLE;
export const PROWESS_DEFINITION_KINDS: Readonly<Record<ProwessDefinitionKind, DefinitionKindSpec>> = deepFreeze(DEFINITION_KIND_TABLE);
export const PROWESS_DEFINITION_KIND_NAMES = deepFreeze(Object.keys(PROWESS_DEFINITION_KINDS).sort() as ProwessDefinitionKind[]);

export const isProwessSystemFamily = (v: unknown): v is ProwessSystemFamily => typeof v === "string" && (PROWESS_SYSTEM_FAMILIES as readonly string[]).includes(v);
export const isProwessDefinitionKind = (v: unknown): v is ProwessDefinitionKind =>
  typeof v === "string" && (PROWESS_DEFINITION_KIND_NAMES as readonly string[]).includes(v);
export const isAbilityKind = (v: unknown): v is AbilityKind => typeof v === "string" && (ABILITY_KINDS as readonly string[]).includes(v);

export function definitionKindSpec(kind: ProwessDefinitionKind): DefinitionKindSpec {
  return PROWESS_DEFINITION_KINDS[kind];
}

/**
 * The exact Definition kind each Ability Construction slot requires, per branch (§29, §33, §44, §51–52, §83). This
 * table — not the shared contract — decides legality: a SPELL_EFFECT satisfies the EFFECT contract but is never a
 * legal MANEUVER effect.
 */
export const ABILITY_SLOT_KINDS = deepFreeze({
  SPELL: {
    targeting: "SPELL_TARGETING",
    effects: "SPELL_EFFECT",
    traits: "SPELL_TRAIT",
    duration: "SPELL_DURATION",
    conditions: "SPELL_CASTING_CONDITION",
    foundation: null,
  },
  MANEUVER: {
    targeting: "MANEUVER_TARGETING",
    effects: "MANEUVER_EFFECT",
    traits: "MANEUVER_TRAIT",
    duration: "MANEUVER_DURATION",
    conditions: "MANEUVER_CONDITION",
    foundation: "MANEUVER_FOUNDATION",
  },
} as const satisfies Record<AbilityKind, Record<string, ProwessDefinitionKind | null>>);
export type AbilitySlot = keyof (typeof ABILITY_SLOT_KINDS)["SPELL"];
