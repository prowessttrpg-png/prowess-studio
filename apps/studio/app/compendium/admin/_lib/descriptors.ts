/**
 * Authoring descriptors (PAS-10 M6-WO1 §12–13, §28, §59) — a PRESENTATION layer that tells the editor how to render the
 * structured fields of a Prowess Definition payload: label, grouping, input type, which M5 vocabulary supplies a
 * select's options, required / optional state, help text, collection behavior and where exact Definition references are
 * expected.
 *
 * A descriptor DESCRIBES the M5 contract; it never decides legality (M6-I002 / M6-I003). It holds no option VALUES
 * (they come from the catalog endpoint, i.e. the M5 domain package's own vocabularies), no numbers, costs, formulas or rules:
 * the M5 validation boundary is the only authority on what is legal. Descriptors are keyed by the M5 SHARED CONTRACT
 * name the catalog reports for each kind, so Spell and Maneuver kinds of the same contract render the same way while
 * remaining different Definition kinds.
 *
 * Opaque M5 sub-objects (`parameters`, `rules`, `geometry`, `data`, `tradeoff` …) are edited with the structured
 * authored-data editor — never as a raw JSON text box — and their content is validated by M5 like everything else.
 */

/** Names a vocabulary in the catalog response (`catalog.vocabularies[name]`) — never the values themselves. */
export type VocabularyName =
  | "targetingSemanticShapes"
  | "resolutionModes"
  | "traitScopes"
  | "durationConcepts"
  | "costCurrencies"
  | "canonicalAffinities"
  | "componentContracts"
  | "prowessStats"
  | "ancestryStatGrantKinds"
  | "ancestrySkillSelectionKinds"
  // M6-WO6 Weapon & Attack Library vocabularies.
  | "weaponCategories"
  | "weaponHandedness"
  | "weaponScalingModels"
  | "attackScalings"
  | "weaponProfileKinds"
  | "equipmentRoles"
  | "damageTypes"
  | "traitExecutionStatuses"
  | "traitUseSites"
  | "traitParameterKinds"
  | "attackTargetingModes"
  | "attackAreaShapes"
  | "attackResolutionModes"
  | "damageOutcomes"
  | "savingThrowDcs"
  | "equipmentModifierTargets"
  | "weaponRequirementKinds"
  // PRE-M7-WO1 core Formula grammar.
  | "derivedStatistics"
  | "coreProcedures"
  | "bonusTargets"
  | "formulaSourceKinds"
  | "derivedFormulaSourceKinds"
  | "characterFields"
  | "formulaRoundings"
  // PRE-M7-WO1 runtime / progression vocabularies.
  | "creatureSizes"
  | "terrainKinds"
  | "weaknessSeverities"
  | "movementFormulaSourceKinds";

/** PRE-M7-WO1: one column of a guided table of flat records (every row keeps any other stored key untouched). */
export type RowColumn =
  | { readonly key: string; readonly label: string; readonly type: "token" | "integer" | "boolean" }
  | { readonly key: string; readonly label: string; readonly type: "select"; readonly vocabulary: VocabularyName };

interface FieldBase {
  /** The payload key this field edits. */
  readonly key: string;
  readonly label: string;
  readonly group: string;
  readonly required: boolean;
  readonly help?: string;
}

export type FieldDescriptor =
  | (FieldBase & { readonly input: "select"; readonly vocabulary: VocabularyName })
  | (FieldBase & { readonly input: "token"; readonly placeholder?: string })
  | (FieldBase & { readonly input: "keywords" })
  | (FieldBase & { readonly input: "compatibility" })
  | (FieldBase & { readonly input: "costContributions" })
  | (FieldBase & { readonly input: "outcomes" })
  | (FieldBase & { readonly input: "resolution" })
  | (FieldBase & { readonly input: "restriction" })
  | (FieldBase & { readonly input: "authoredData" })
  // M6-WO3 character-facing inputs.
  | (FieldBase & { readonly input: "integer" })
  | (FieldBase & { readonly input: "statGrants" })
  | (FieldBase & { readonly input: "skillGrants"; readonly optionKind: string })
  | (FieldBase & { readonly input: "source" })
  // M6-WO4: the per-Level advancement entitlement table.
  | (FieldBase & { readonly input: "advancementLevels" })
  // M6-WO6 Weapon / Attack / Equipment Trait inputs (structured, never raw JSON).
  | (FieldBase & { readonly input: "nullableSelect"; readonly vocabulary: VocabularyName })
  | (FieldBase & { readonly input: "text" })
  | (FieldBase & { readonly input: "textList" })
  | (FieldBase & { readonly input: "traitUses"; readonly refKind: string })
  | (FieldBase & { readonly input: "traitUse"; readonly refKind: string })
  | (FieldBase & { readonly input: "attackRefs"; readonly refKind: string })
  // PRE-M7-WO1: an authored core Formula, edited as contributions / inputs / advanced expression (never raw JSON).
  | (FieldBase & { readonly input: "coreFormula"; readonly sources: VocabularyName; readonly ownStatisticKey?: string })
  // PRE-M7-WO1: guided tables, whole-number lists, true/false and an optional { feet } value.
  | (FieldBase & { readonly input: "rows"; readonly columns: readonly RowColumn[]; readonly itemLabel: string })
  | (FieldBase & { readonly input: "integerList" })
  | (FieldBase & { readonly input: "boolean" })
  | (FieldBase & { readonly input: "optionalFeet" })
  | (FieldBase & { readonly input: "damageProfiles" })
  | (FieldBase & { readonly input: "weaponRequirements" })
  | (FieldBase & { readonly input: "equippedModifiers" })
  | (FieldBase & { readonly input: "grantedFeatures" })
  | (FieldBase & { readonly input: "attackTargeting" })
  | (FieldBase & { readonly input: "attackResolution" })
  | (FieldBase & { readonly input: "traitParameters" })
  | (FieldBase & { readonly input: "useSites" })
  | (FieldBase & { readonly input: "equipmentSource" })
  | (FieldBase & { readonly input: "traitContract" });

export interface ContractDescriptor {
  /** Short explanation of what this kind of Definition is FOR (§59) — presentation only. */
  readonly purpose: string;
  readonly fields: readonly FieldDescriptor[];
}

const KEYWORDS: FieldDescriptor = {
  key: "keywords",
  label: "Keywords",
  group: "Keywords",
  input: "keywords",
  required: false,
  help: "Structured rules metadata: choose existing Keyword Definitions. Unknown Keywords fail validation — a Keyword never becomes a rule just because it is named here.",
};
const COMPATIBILITY: FieldDescriptor = {
  key: "compatibility",
  label: "Compatibility",
  group: "Compatibility",
  input: "compatibility",
  required: false,
  help: "Which components this Definition may combine with: a relation and the exact labels (canonical keys or vocabulary tokens) it allows.",
};
const COSTS: FieldDescriptor = {
  key: "costContributions",
  label: "Cost contributions",
  group: "Costs",
  input: "costContributions",
  required: false,
  help: "Authored cost data per currency. The editor never computes a cost — the Rules Engine does, from this data.",
};
const PARAMETERS: FieldDescriptor = { key: "parameters", label: "Parameters", group: "Rules data", input: "authoredData", required: false, help: "Authored parameter declarations for this component." };
const RULES: FieldDescriptor = {
  key: "rules",
  label: "Rules",
  group: "Rules data",
  input: "authoredData",
  required: false,
  help: "Structured rule data owned by the M5 contract for this kind. Everything that matters to the engine must be here — never only in Rules Text.",
};
const COMMON: readonly FieldDescriptor[] = [KEYWORDS, COMPATIBILITY, COSTS, PARAMETERS, RULES];

/** Descriptors per M5 SHARED CONTRACT (`sharedContract` in the catalog). */
export const CONTRACT_DESCRIPTORS: Readonly<Record<string, ContractDescriptor>> = {
  TARGETING: {
    purpose: "Targeting decides WHERE and HOW an ability is delivered — shape, geometry, range, count, placement. It never decides what happens: Damage, Healing, Saves and outcomes belong to Effects.",
    fields: [
      { key: "semanticShape", label: "Semantic shape", group: "Classification", input: "select", vocabulary: "targetingSemanticShapes", required: true, help: "A classifier of the geometry's meaning — never identity." },
      { key: "geometry", label: "Geometry", group: "Geometry", input: "authoredData", required: false, help: "Origin, range, area, count, delivery and placement data." },
      ...COMMON,
    ],
  },
  EFFECT: {
    purpose: "An Effect decides WHAT HAPPENS — its family, how it resolves and its outcomes. Effects carry the fullest mechanical data.",
    fields: [
      { key: "effectFamily", label: "Effect family", group: "Classification", input: "token", required: true, help: "The source-defined family token (SCREAMING_SNAKE_CASE)." },
      { key: "resolution", label: "Resolution", group: "Resolution & outcomes", input: "resolution", required: false, help: "How this Effect resolves (its own resolution) and the structured resolution data." },
      { key: "outcomes", label: "Outcomes", group: "Resolution & outcomes", input: "outcomes", required: false, help: "Named outcomes with their structured data." },
      ...COMMON,
    ],
  },
  TRAIT: {
    purpose: "A Trait MODIFIES an explicitly scoped part of an ability. It never becomes an independent Effect.",
    fields: [
      { key: "traitFamily", label: "Trait family", group: "Classification", input: "token", required: true },
      { key: "scope", label: "Scope", group: "Classification", input: "select", vocabulary: "traitScopes", required: true, help: "What the Trait applies to — never assumed ability-wide." },
      ...COMMON,
    ],
  },
  DURATION: {
    purpose: "A Duration describes how long an ability's result lasts, as exact structured Duration data.",
    fields: [{ key: "durationConcept", label: "Duration concept", group: "Classification", input: "select", vocabulary: "durationConcepts", required: true }, ...COMMON],
  },
  ABILITY_CONDITION: {
    purpose: "An Ability Condition is a restriction on USING an ability, traded for an authored benefit. It never applies a status to a target.",
    fields: [
      { key: "restriction", label: "Restriction", group: "Restriction & tradeoff", input: "restriction", required: true, help: "The restriction key (SCREAMING_SNAKE_CASE) and its structured data." },
      { key: "tradeoff", label: "Tradeoff", group: "Restriction & tradeoff", input: "authoredData", required: false, help: "The exact authored modifier data the restriction buys." },
      ...COMMON,
    ],
  },
  FOUNDATION: {
    purpose: "A Maneuver Foundation is the action a Maneuver starts from (the existing M5 Foundation contract).",
    fields: [{ key: "foundationKind", label: "Foundation kind", group: "Classification", input: "token", required: true }, ...COMMON],
  },
};

/** Version-1 AFFINITY: identity only (its canonical Affinity). Later versions use the generic editor. */
const AFFINITY_V1: ContractDescriptor = {
  purpose: "An Affinity identity. Canonical structured content uses the canonical Affinity (never a legacy term).",
  fields: [{ key: "affinity", label: "Affinity", group: "Classification", input: "select", vocabulary: "canonicalAffinities", required: true }],
};

const SOURCE: FieldDescriptor = { key: "source", label: "Source", group: "Source", input: "source", required: true, help: "Core Playtest section keys (sNNN) this content is structured from, and any source-conflict keys (M5-SC-NNN)." };

/**
 * PAS-10 M6-WO3: the character-facing Definition kinds activated at version 1. They have no Ability shared contract, so
 * they are described per KIND (presentation only — every value is authored and validated by the M5 contract).
 */
export const CHARACTER_KIND_DESCRIPTORS: Readonly<Record<string, ContractDescriptor>> = {
  ANCESTRY: {
    purpose: "An Ancestry (Race): the structured values Character creation reads — Base HP / MP and the Stat and starting-Skill grants. Racial features and history stay in Rules Text.",
    fields: [
      { key: "baseHp", label: "Base HP", group: "Base values", input: "integer", required: true, help: "Feeds the Release's Maximum HP Derived Stat — never a Maximum HP itself." },
      { key: "baseMp", label: "Base MP", group: "Base values", input: "integer", required: true, help: "Feeds the Release's Maximum MP Derived Stat." },
      { key: "statGrants", label: "Stat grants", group: "Stat grants", input: "statGrants", required: false, help: "Fixed Stat adjustments, or a choice of different Stats. Each grant needs a stable key." },
      { key: "skillGrants", label: "Starting Skill grants", group: "Skill grants", input: "skillGrants", optionKind: "SKILL", required: false, help: "Skills granted at creation: fixed, choose from a list of exact Skills, or choose any published Skill." },
      SOURCE,
    ],
  },
  SKILL: {
    purpose: "A Skill's identity: what Characters are trained in. Skill Actions evolve separately; describe the Skill in Rules Text.",
    fields: [{ key: "ladderKey", label: "Rank ladder", group: "Identity", input: "token", required: true, help: "The rank ladder this Skill is trained on (the Skill rank ladder: SKILL)." }, SOURCE],
  },
  CHARACTER_CREATION_RULE: {
    purpose: "The Level-1 creation values: starting Level, Stat point budget, free trained Skills, the starting Skill rank and required selections.",
    fields: [
      { key: "startingLevel", label: "Starting Level", group: "Creation", input: "integer", required: true },
      { key: "statPointBudget", label: "Stat point budget", group: "Creation", input: "integer", required: true, help: "Points a player distributes at creation. Stat minimum / maximum come from the STAT Definitions." },
      { key: "freeTrainedSkillCount", label: "Free trained Skills", group: "Creation", input: "integer", required: true },
      { key: "startingSkillRankKey", label: "Starting Skill rank", group: "Creation", input: "token", required: true, help: "A rank of the Skill rank ladder (e.g. TRAINED)." },
      { key: "requiredAncestryCount", label: "Required Ancestries", group: "Required selections", input: "integer", required: true, help: "Version 1: exactly 1." },
      { key: "requiredPrimaryAffinityCount", label: "Required Primary Affinities", group: "Required selections", input: "integer", required: true, help: "Version 1: exactly 1." },
      SOURCE,
    ],
  },
  CHARACTER_ADVANCEMENT_RULE: {
    purpose: "The advancement entitlements of each Level after creation: Stat Points and Skill advancements. The Character Die (Character Die Progression) and Affinity advancement (Affinity Progression) are owned by their own Definitions.",
    fields: [
      { key: "levels", label: "Levels", group: "Advancement by Level", input: "advancementLevels", required: true, help: "One row per Level a Character can reach after creation, in ascending order. They must be exactly the Character Die progression's Levels after the creation Level." },
      SOURCE,
    ],
  },
};

/** The exact kinds the Weapon editors' reference pickers search (sanctioned kind names, like SKILL above; m6-wo6-static). */
const ATTACK_KIND = "ATTACK";
const EQUIPMENT_TRAIT_KIND = "EQUIPMENT_TRAIT";

const EQUIPMENT_SOURCE: FieldDescriptor = {
  key: "source",
  label: "Source",
  group: "Source",
  input: "equipmentSource",
  required: true,
  help: "Core Playtest section keys (sNNN), source-conflict keys and the designer rulings (e.g. M6-WO6 §103) this content applies.",
};

/**
 * PAS-10 M6-WO6: the EQUIPMENT-family kinds activated at version 1 (WEAPON, ATTACK, EQUIPMENT_TRAIT). Presentation only
 * — every value is authored and validated by the WO6 contract. Recommended order (§93): author the Attacks first, then
 * the Weapon, choosing the exact Attack revisions for its Moveset (no circular references).
 */
export const EQUIPMENT_KIND_DESCRIPTORS: Readonly<Record<string, ContractDescriptor>> = {
  WEAPON: {
    purpose: "A Weapon profile: its family, role, handedness and explicit damage scaling, its Weapon properties and its Moveset — an ordered list of EXACT Attack revisions. Author the Attacks first. The Move owns its AP; the Category never does.",
    fields: [
      { key: "familyKey", label: "Weapon family", group: "Identity", input: "token", required: true, help: "Stable family token (e.g. LONG_BLADE). Every Moveset Attack names the same family." },
      { key: "profileKind", label: "Profile kind", group: "Identity", input: "select", vocabulary: "weaponProfileKinds", required: true, help: "STANDARD (held), UNARMED (intrinsic, by Martial rank — never equipped) or IMPROVISED (generated profile)." },
      { key: "equipmentRole", label: "Equipment role", group: "Identity", input: "select", vocabulary: "equipmentRoles", required: true, help: "A Shield is explicit — never recognized by name. Shield + Weapon is not Dual Wielding." },
      { key: "martialRankKey", label: "Martial rank (Unarmed only)", group: "Identity", input: "token", required: false, help: "Only an Unarmed profile names the exact Martial rank it belongs to." },
      { key: "exampleForms", label: "Example forms", group: "Identity", input: "textList", required: false, help: "Descriptive forms (katana, saber …). A form never has its own mechanics." },
      { key: "category", label: "Category", group: "Profile", input: "nullableSelect", vocabulary: "weaponCategories", required: false, help: "General role only — never AP, damage, Power or handedness." },
      { key: "handedness", label: "Handedness", group: "Profile", input: "nullableSelect", vocabulary: "weaponHandedness", required: false, help: "Leave unset only where canon authors none (the profile is then shown but never equipped)." },
      { key: "scalingModel", label: "Damage scaling", group: "Scaling", input: "select", vocabulary: "weaponScalingModels", required: true, help: "Mandatory and explicit: POWER, STATIC or HYBRID. Never inferred from Power." },
      { key: "power", label: "Power", group: "Scaling", input: "integer", required: false, help: "Empty on a STATIC Weapon — never a fake 0." },
      { key: "scalingRule", label: "Power scaling rule", group: "Scaling", input: "traitUse", refKind: EQUIPMENT_TRAIT_KIND, required: false, help: "The exact POWER_SCALING Equipment Trait (Power-scaled Weapons only)." },
      { key: "versatileRule", label: "Versatile die-step rule", group: "Scaling", input: "traitUse", refKind: EQUIPMENT_TRAIT_KIND, required: false, help: "The exact Versatile Equipment Trait (VERSATILE Weapons only)." },
      { key: "weaponProperties", label: "Weapon properties", group: "Properties", input: "traitUses", refKind: EQUIPMENT_TRAIT_KIND, required: false, help: "Exact Equipment Traits with explicit parameters (e.g. Loading capacity 12, Loud radius 200)." },
      { key: "moveset", label: "Moveset", group: "Moveset", input: "attackRefs", refKind: ATTACK_KIND, required: true, help: "Ordered, exact Attack revisions of the same Weapon family. No generic Weapon Attack exists." },
      { key: "requirements", label: "Requirements", group: "Requirements & equipment", input: "weaponRequirements", required: false, help: "Structured: a Martial rank or a Stat minimum — evaluated by the Rules Engine, never parsed from text." },
      { key: "equippedModifiers", label: "While-equipped modifiers", group: "Requirements & equipment", input: "equippedModifiers", required: false, help: "Armor / Dodge / Movement adjustments applied to the Character profile while equipped — derived, never stored." },
      { key: "grantedFeatures", label: "Granted features", group: "Requirements & equipment", input: "grantedFeatures", required: false, help: "Reference-only rule text (e.g. Deflect Shot). WO6 executes none." },
      EQUIPMENT_SOURCE,
    ],
  },
  ATTACK: {
    purpose: "One exact Weapon Move: its own AP and MP, structured damage profiles, targeting and resolution. The Weapon names this exact revision in its Moveset; the Attack names only its Weapon family (no circular reference).",
    fields: [
      { key: "moveKey", label: "Move key", group: "Identity", input: "token", required: true, help: "e.g. SLASH. Display text, never identity — two Weapons may both have a Bash." },
      { key: "weaponFamilyKey", label: "Weapon family", group: "Identity", input: "token", required: true },
      { key: "apCost", label: "AP cost", group: "Cost", input: "integer", required: true, help: "The Move owns its AP — never inferred from the Weapon Category." },
      { key: "mpCost", label: "MP cost", group: "Cost", input: "integer", required: true },
      { key: "damageProfiles", label: "Damage profiles", group: "Damage", input: "damageProfiles", required: true, help: "Dice (count × sides) and damage type. Several profiles are explicit selectable options — never auto-selected." },
      { key: "scaling", label: "Scaling (HYBRID Weapons only)", group: "Damage", input: "nullableSelect", vocabulary: "attackScalings", required: false, help: "Required on a HYBRID Weapon's Attacks; empty otherwise (the Attack follows its Weapon)." },
      { key: "accuracyModifier", label: "Accuracy adjustment", group: "Damage", input: "integer", required: true, help: "e.g. −2 for Burst. Accuracy — never a separate To-Hit statistic." },
      { key: "targeting", label: "Targeting", group: "Targeting & resolution", input: "attackTargeting", required: true },
      { key: "resolution", label: "Resolution", group: "Targeting & resolution", input: "attackResolution", required: true },
      { key: "moveProperties", label: "Move properties", group: "Properties", input: "traitUses", refKind: EQUIPMENT_TRAIT_KIND, required: false },
      { key: "requirements", label: "Requirements", group: "Properties", input: "weaponRequirements", required: false },
      EQUIPMENT_SOURCE,
    ],
  },
  EQUIPMENT_TRAIT: {
    purpose: "A reusable Weapon / Attack property. EXECUTABLE only with a complete machine-readable contract; otherwise REFERENCE_ONLY (valid but not executed) or DEFERRED (canon incomplete). Behavior is never invented.",
    fields: [
      { key: "traitKey", label: "Trait key", group: "Identity", input: "token", required: true },
      { key: "useSites", label: "Used on", group: "Identity", input: "useSites", required: true },
      { key: "executionStatus", label: "Execution status", group: "Execution", input: "select", vocabulary: "traitExecutionStatuses", required: true },
      { key: "contract", label: "Executable contract", group: "Execution", input: "traitContract", required: false, help: "Only for EXECUTABLE traits: one complete contract the Rules Engine understands." },
      { key: "parameters", label: "Parameters", group: "Parameters", input: "traitParameters", required: false, help: "Declared parameters (e.g. amount for Pierce X)." },
      { key: "summary", label: "Summary", group: "Summary", input: "text", required: true, help: "Inert reference text — never parsed for behavior." },
      EQUIPMENT_SOURCE,
    ],
  },
};

/** Kinds without a dedicated descriptor: the whole payload is edited as structured authored data. */
/**
 * PRE-M7-WO1: core Character kinds — a Stat's identity and range, and a derived statistic's Formula. Presentation only:
 * the M5 core readers validate every value (variables declared exactly once and used, bonus target iff an
 * EXPLICIT_BONUSES input, known statistics), and the rule preview evaluates candidates with the shared engine.
 */
const CORE_SOURCE: FieldDescriptor = { key: "source", label: "Source", group: "Source", input: "source", required: true, help: "Core Playtest section keys (sNNN) this rule comes from, and any source-conflict keys." };
export const CORE_KIND_DESCRIPTORS: Readonly<Record<string, ContractDescriptor>> = {
  STAT: {
    purpose: "A Stat's identity and its legal range. What the Stat DOES is owned by the rules that read it — see Stats → this Stat → What this affects.",
    fields: [
      { key: "stat", label: "Stat", group: "Identity", input: "select", vocabulary: "prowessStats", required: true, help: "The Stat this Definition describes (one Definition per Stat in a Release)." },
      { key: "minimum", label: "Minimum value", group: "Range", input: "integer", required: true },
      { key: "maximum", label: "Maximum value", group: "Range", input: "integer", required: true },
      CORE_SOURCE,
    ],
  },
  DERIVED_STAT: {
    purpose: "A derived statistic and the Formula that computes it — for example Armor from Strength. Characters, builders, cards and play read the value computed from the exact Release's Formula.",
    fields: [
      { key: "statistic", label: "Statistic", group: "Identity", input: "select", vocabulary: "derivedStatistics", required: true, help: "The statistic this rule computes (one rule per statistic in a Release)." },
      { key: "formula", label: "Formula", group: "Calculation", input: "coreFormula", sources: "derivedFormulaSourceKinds", ownStatisticKey: "statistic", required: true, help: "Add, remove or change contributions. A rule with no contributions is the constant 0 — the statistic still exists." },
      { key: "bonusTarget", label: "Explicit bonuses apply to", group: "Calculation", input: "nullableSelect", vocabulary: "bonusTargets", required: false, help: "Set exactly when the Formula reads an Explicit Bonuses input." },
      CORE_SOURCE,
    ],
  },
};

/**
 * PRE-M7-WO1: guided editors for the uniform core / runtime / progression kinds. Field keys are EXACTLY the M5 reader's
 * required-and-allowed keys (a strict record), so a new Definition starts with a complete, readable shape.
 */
const RULES_FIELD: FieldDescriptor = { key: "rules", label: "Rule notes", group: "Rules data", input: "authoredData", required: true, help: "Authored rule data the engine carries with this Definition (empty group = none)." };
export const RUNTIME_KIND_DESCRIPTORS: Readonly<Record<string, ContractDescriptor>> = {
  RANK_LADDER: {
    purpose: "A rank ladder: the ordered ranks a Skill (or another ladder user) can hold. Order 0 is the lowest rank.",
    fields: [
      { key: "ladderKey", label: "Ladder", group: "Identity", input: "token", required: true, help: "The ladder's token, e.g. SKILL." },
      { key: "ranks", label: "Ranks", group: "Ranks", input: "rows", itemLabel: "rank", required: true, columns: [{ key: "rankKey", label: "Rank", type: "token" }, { key: "order", label: "Order", type: "integer" }] },
      CORE_SOURCE,
    ],
  },
  SKILL_RANK: {
    purpose: "What each rank of a ladder means for Skill checks: its bonus and whether an attempt is allowed at that rank.",
    fields: [
      { key: "ladderKey", label: "Ladder", group: "Identity", input: "token", required: true, help: "The rank ladder these entries give meaning to." },
      { key: "entries", label: "Rank bonuses", group: "Ranks", input: "rows", itemLabel: "rank", required: true, columns: [{ key: "rankKey", label: "Rank", type: "token" }, { key: "bonus", label: "Bonus", type: "integer" }, { key: "attemptAllowed", label: "Attempt allowed", type: "boolean" }] },
      CORE_SOURCE,
    ],
  },
  CHARACTER_DIE_PROGRESSION: {
    purpose: "The Character Die: every legal Character Level, the dice, and which die each band of Levels uses (each Level in exactly one band).",
    fields: [
      { key: "levels", label: "Character Levels", group: "Levels", input: "integerList", required: true, help: "Every legal Level, strictly increasing." },
      { key: "dice", label: "Dice", group: "Dice", input: "rows", itemLabel: "die", required: true, columns: [{ key: "dieKey", label: "Die", type: "token" }, { key: "faces", label: "Faces", type: "integer" }] },
      { key: "progression", label: "Die by Level", group: "Dice", input: "rows", itemLabel: "band", required: true, columns: [{ key: "levelMinimum", label: "From Level", type: "integer" }, { key: "levelMaximum", label: "To Level", type: "integer" }, { key: "dieKey", label: "Die", type: "token" }] },
      CORE_SOURCE,
    ],
  },
  AFFINITY_WEAKNESS_SEVERITY: {
    purpose: "How much each Weakness severity raises a matching Ability's cost, as a percentage.",
    fields: [
      { key: "severities", label: "Severities", group: "Severities", input: "rows", itemLabel: "severity", required: true, columns: [{ key: "severity", label: "Severity", type: "select", vocabulary: "weaknessSeverities" }, { key: "percent", label: "Percent", type: "integer" }] },
      CORE_SOURCE,
    ],
  },
  TERRAIN: {
    purpose: "A terrain kind and how much movement allowance crossing it costs (the formula reads the distance moved exactly once).",
    fields: [
      { key: "terrainKey", label: "Terrain", group: "Identity", input: "select", vocabulary: "terrainKinds", required: true },
      { key: "allowanceCost", label: "Movement allowance cost", group: "Calculation", input: "coreFormula", sources: "movementFormulaSourceKinds", required: true, help: "For example the distance moved, or twice it for difficult terrain." },
      RULES_FIELD,
      CORE_SOURCE,
    ],
  },
  CREATURE_SIZE: {
    purpose: "A creature Size: the space it occupies and its Base Movement.",
    fields: [
      { key: "sizeKey", label: "Size", group: "Identity", input: "select", vocabulary: "creatureSizes", required: true },
      { key: "occupiedSpaceFeet", label: "Occupied space (feet)", group: "Space", input: "integerList", required: true, help: "One or two dimensions, e.g. 5 or 10, 10." },
      { key: "orLarger", label: "This size or larger", group: "Space", input: "boolean", required: true },
      { key: "baseMovement", label: "Base Movement (feet)", group: "Movement", input: "optionalFeet", required: false, help: "Leave empty while the value is not yet decided." },
      RULES_FIELD,
      CORE_SOURCE,
    ],
  },
};

export const GENERIC_DESCRIPTOR: ContractDescriptor = {
  purpose: "This kind has no dedicated authoring descriptor yet: author its payload as structured data. The M5 contract still validates every field.",
  fields: [{ key: "", label: "Payload", group: "Payload", input: "authoredData", required: true, help: "The complete payload for this Definition kind." }],
};

export function descriptorFor(kind: { definitionKind: string; sharedContract: string | null }, schemaVersion: number | null): ContractDescriptor {
  if (kind.sharedContract !== null && CONTRACT_DESCRIPTORS[kind.sharedContract] !== undefined) return CONTRACT_DESCRIPTORS[kind.sharedContract] as ContractDescriptor;
  if (schemaVersion === 1 && CHARACTER_KIND_DESCRIPTORS[kind.definitionKind] !== undefined) return CHARACTER_KIND_DESCRIPTORS[kind.definitionKind] as ContractDescriptor;
  if (schemaVersion === 1 && CORE_KIND_DESCRIPTORS[kind.definitionKind] !== undefined) return CORE_KIND_DESCRIPTORS[kind.definitionKind] as ContractDescriptor;
  if (schemaVersion === 1 && EQUIPMENT_KIND_DESCRIPTORS[kind.definitionKind] !== undefined) return EQUIPMENT_KIND_DESCRIPTORS[kind.definitionKind] as ContractDescriptor;
  if (schemaVersion === 1 && RUNTIME_KIND_DESCRIPTORS[kind.definitionKind] !== undefined) return RUNTIME_KIND_DESCRIPTORS[kind.definitionKind] as ContractDescriptor;
  if (kind.definitionKind === "AFFINITY" && schemaVersion === 1) return AFFINITY_V1;
  return GENERIC_DESCRIPTOR;
}

/**
 * Version-2 AFFINITY, for READ-ONLY presentation in the Rules Reference (PAS-10 M6-WO2): the Affinity identity, its
 * themes and its authored Strength / Weakness rules, shown exactly as stored. Authoring of version 2 still uses the
 * generic editor (descriptorFor is unchanged); this only labels and groups the stored fields for readers.
 */
const AFFINITY_V2_PRESENTATION: ContractDescriptor = {
  purpose: "An Affinity: its identity, themes, and the authored Strengths and Weaknesses that match Keywords. Percentages are shown as authored — never applied here.",
  fields: [
    { key: "affinity", label: "Affinity", group: "Classification", input: "select", vocabulary: "canonicalAffinities", required: true },
    { key: "identity", label: "Identity", group: "Identity", input: "authoredData", required: true },
    { key: "strengths", label: "Strengths", group: "Strengths & Weaknesses", input: "authoredData", required: false },
    { key: "weaknesses", label: "Weaknesses", group: "Strengths & Weaknesses", input: "authoredData", required: false },
    { key: "source", label: "Source", group: "Source", input: "authoredData", required: false },
  ],
};

/**
 * The read-only presentation descriptor for a STORED Definition (PAS-10 M6-WO2 Rules Reference): the same descriptor
 * the editor uses for the kind's shared contract (no second catalog), plus the version-2 Affinity presentation. Null
 * means "present generically": a kind without a dedicated descriptor, or a schema version the catalog does not list as
 * supported for the kind (historical / future content renders as stored — never migrated on view).
 */
export function presentationDescriptorFor(kind: { definitionKind: string; sharedContract: string | null; supportedSchemaVersions: readonly number[] }, schemaVersion: number | null): ContractDescriptor | null {
  if (schemaVersion === null || !kind.supportedSchemaVersions.includes(schemaVersion)) return null;
  if (kind.definitionKind === "AFFINITY" && schemaVersion === 2) return AFFINITY_V2_PRESENTATION;
  const descriptor = descriptorFor(kind, schemaVersion);
  return descriptor === GENERIC_DESCRIPTOR ? null : descriptor;
}

/** Field groups in first-appearance order. */
export function groupsOf(descriptor: ContractDescriptor): string[] {
  return [...new Set(descriptor.fields.map((f) => f.group))];
}

/** The empty value a field starts with in a new Definition (shape only — every value is the author's). */
export function initialFieldValue(field: FieldDescriptor): unknown {
  switch (field.input) {
    case "select":
    case "token":
      return "";
    case "keywords":
    case "compatibility":
    case "costContributions":
    case "outcomes":
      return [];
    case "resolution":
      return null;
    case "restriction":
      return { restrictionKey: "", data: {} };
    case "authoredData":
      return {};
    case "integer":
      return null;
    case "statGrants":
    case "skillGrants":
    case "advancementLevels":
      return [];
    case "source":
      return { locators: [], conflicts: [] };
    case "nullableSelect":
    case "traitUse":
    case "traitContract":
      return null;
    case "text":
      return "";
    case "textList":
    case "traitUses":
    case "attackRefs":
    case "damageProfiles":
    case "weaponRequirements":
    case "equippedModifiers":
    case "grantedFeatures":
    case "traitParameters":
    case "useSites":
      return [];
    case "attackTargeting":
    case "attackResolution":
      // The author chooses the mode from the catalog; the editor then shapes that mode's fields.
      return { mode: "" };
    case "equipmentSource":
      return { locators: [], conflicts: [], designerAuthority: [] };
    case "rows":
    case "integerList":
      return [];
    case "boolean":
      return false;
    case "optionalFeet":
      return null;
    case "coreFormula":
      return { expression: "0", rounding: "NONE", minimum: null, maximum: null, unit: null, variables: [] };
  }
}

/** A new, empty payload for a descriptor (the generic descriptor's single field IS the payload). */
export function initialPayload(descriptor: ContractDescriptor): Record<string, unknown> {
  if (descriptor === GENERIC_DESCRIPTOR) return {};
  return Object.fromEntries(descriptor.fields.map((f) => [f.key, initialFieldValue(f)]));
}
