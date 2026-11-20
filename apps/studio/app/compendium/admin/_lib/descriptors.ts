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
  | "movementFormulaSourceKinds"
  | "rollFormulaSourceKinds"
  | "initiativeFormulaSourceKinds"
  | "movementGrantSourceKinds"
  | "mageArtActiveEffectWindows"
  | "actionTimings"
  | "actionCostModels"
  | "variableCostDeterminers"
  | "paymentPolicies"
  | "combatTimingEvents"
  | "runtimeResourceKeys"
  | "resourceKinds"
  | "resourceMaximumSources"
  | "resourceRefreshTargets"
  | "resourceExpiryTargets"
  | "resourceSpending"
  | "resourceCeilings"
  | "resourceOverflowPolicies"
  | "resourceUsageRestrictions"
  | "rollModes"
  | "rollProcedures"
  | "initiativeTiebreakKinds"
  | "affinityRanks"
  | "affinityProgressionModes"
  | "affinityAdvancementActions"
  | "affinityRankUpTargets"
  | "affinityRoles"
  | "actionImprovementPrerequisites"
  | "actionImprovementModifications"
  // RULES-WO1 authored values, Skill benefits and the Concentration rule.
  | "canonStatuses"
  | "calculatedValuePlacements"
  | "valueInputKinds"
  | "valueBaseSourceKinds"
  | "benefitAmountSourceKinds"
  | "concentrationCapacitySourceKinds"
  | "concentrationUpkeepSourceKinds"
  // RULES-WO1 Phase C reference families.
  | "armorCategories"
  | "stealthEffects"
  | "conditionDurationModels"
  | "conditionOngoingTimings"
  | "conditionStacking"
  | "summonEngines"
  | "summonSustainModes"
  | "summonCostSourceKinds"
  | "summonLimitSourceKinds"
  | "missionRuleShapes"
  | "referenceRuleShapes"
  | "clockVisibilities"
  | "metamagicForms";

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
  | (FieldBase & { readonly input: "token"; readonly placeholder?: string; /** RULES-WO1: filled in from the Display Name. */ readonly fromName?: boolean })
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
  | (FieldBase & { readonly input: "text"; readonly nullable?: boolean })
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
  // PRE-M7-WO1: recursive structure — a nested record, a list of records, a record whose shape depends on a
  // discriminator, several values of one vocabulary, a single-line text and one exact Definition reference.
  | (FieldBase & { readonly input: "group"; readonly fields: readonly FieldDescriptor[]; readonly nullable?: boolean })
  | (FieldBase & { readonly input: "list"; readonly item: readonly FieldDescriptor[]; readonly itemLabel: string })
  | (FieldBase & { readonly input: "variant"; readonly discriminator: string; readonly vocabulary: VocabularyName; readonly variants: Readonly<Record<string, readonly FieldDescriptor[]>>; readonly nullable?: boolean })
  | (FieldBase & { readonly input: "multiSelect"; readonly vocabulary: VocabularyName })
  | (FieldBase & { readonly input: "line" })
  | (FieldBase & { readonly input: "byVocabulary"; readonly vocabulary: VocabularyName; readonly fields: readonly FieldDescriptor[] })
  | (FieldBase & { readonly input: "optionalData" })
  | (FieldBase & { readonly input: "reference"; readonly refKind: string })
  // PRE-M7-WO1: a whole reusable Spell / Maneuver Definition (key "" = the payload), edited by component slots.
  | (FieldBase & { readonly input: "abilityDefinition"; readonly branch: "spell" | "maneuver"; readonly affinityKind: string })
  | (FieldBase & { readonly input: "damageProfiles" })
  | (FieldBase & { readonly input: "weaponRequirements" })
  | (FieldBase & { readonly input: "equippedModifiers" })
  | (FieldBase & { readonly input: "grantedFeatures" })
  | (FieldBase & { readonly input: "attackTargeting" })
  | (FieldBase & { readonly input: "attackResolution" })
  | (FieldBase & { readonly input: "traitParameters" })
  | (FieldBase & { readonly input: "useSites" })
  | (FieldBase & { readonly input: "equipmentSource" })
  | (FieldBase & { readonly input: "traitContract" })
  // RULES-WO1: a Formula the source may leave unstated (null = "not stated"), and a source citation that may be absent.
  | (FieldBase & { readonly input: "optionalFormula"; readonly sources: VocabularyName; readonly absentLabel: string; readonly presentLabel: string; readonly presetFromStat?: boolean })
  | (FieldBase & { readonly input: "optionalSource" })
  | (FieldBase & { readonly input: "refList"; readonly refKind: string; readonly itemLabel: string })
  // RULES-WO1 Phase C: yes / no / not stated, and the whole Mission rule (its parts depend on the chosen shape).
  | (FieldBase & { readonly input: "triState"; readonly yes: string; readonly no: string; readonly unknown: string })
  | (FieldBase & { readonly input: "missionRule"; readonly shapes?: VocabularyName; /** RULES-WO1: the rule-name part filled in from the Display Name. */ readonly nameKey?: string })
  // RULES-WO1: a token that names other content, chosen from what exists (a Skill rank, a calculated value).
  | (FieldBase & { readonly input: "contentToken"; readonly options: "skillRanks" | "calculatedValues" });

export interface ContractDescriptor {
  /** Short explanation of what this kind of Definition is FOR (§59) — presentation only. */
  readonly purpose: string;
  /** RULES-WO1: previewed with a sample Character (authored values, Skill benefits, the Concentration rule), or with
   *  sample inputs for a reference family (Armor, Summon engine, Mission rule). */
  readonly preview?: "AUTHORED_RULE" | "SAMPLE_INPUTS";
  /** RULES-WO1 Phase C: the sample a reference preview asks for. */
  readonly previewSample?: "SHEET" | "TIERED_SHEET" | "ROLL_OR_CLOCK";
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

/**
 * PRE-M7-WO1: reusable Compendium Spell and Maneuver Definitions (distinct from a Character's own Signature abilities).
 * One composite field edits the whole payload by labelled component slots; every key it does not show is kept.
 */
export const ABILITY_DEFINITION_DESCRIPTORS: Readonly<Record<string, ContractDescriptor>> = {
  SPELL_DEFINITION: {
    purpose: "A reusable Spell: its name and description, and the exact Targeting, Effects, Traits, Duration, Casting Conditions and Affinity it is composed of. Components are chosen by exact revision; the values chosen here belong to this Spell only.",
    fields: [{ key: "", label: "Spell", group: "Spell", input: "abilityDefinition", branch: "spell", affinityKind: "AFFINITY", required: true }],
  },
  MANEUVER_DEFINITION: {
    purpose: "A reusable Maneuver: its name and description, the exact actions (foundations) it commits, and the Effects (attached to actions), Traits, Duration, Conditions and Affinity it is composed of.",
    fields: [{ key: "", label: "Maneuver", group: "Maneuver", input: "abilityDefinition", branch: "maneuver", affinityKind: "AFFINITY", required: true }],
  },
};

/** A new, empty ability payload in the exact M5 shape (every slot present, nothing chosen). */
export function initialAbilityPayload(branch: "spell" | "maneuver"): Record<string, unknown> {
  const kind = branch.toUpperCase();
  const base = { compositionKey: "", abilityKind: kind, affinity: null, authority: null, keywords: [], effects: [], traits: [], duration: null, conditions: [] };
  return branch === "spell"
    ? { name: "", description: "", composition: { ...base, targeting: null, branch: { kind, effectChain: null, sustain: null, concentration: null, data: {} } }, additionalAffinityTraits: [], constructionOptions: { effectSlotsTradedForTraits: 0 } }
    : { name: "", description: "", composition: base, actions: [], effectAttachments: [], powerfulBlow: null };
}

// ---- PRE-M7-WO1: the remaining editable kinds, field by field (keys are exactly the M5 readers') -------------------
const n = (key: string, label: string, help?: string): FieldDescriptor => ({ key, label, group: "", input: "integer", required: true, ...(help ? { help } : {}) });
const sel = (key: string, label: string, vocabulary: VocabularyName): FieldDescriptor => ({ key, label, group: "", input: "select", vocabulary, required: true });
const flag = (key: string, label: string, help?: string): FieldDescriptor => ({ key, label, group: "", input: "boolean", required: true, ...(help ? { help } : {}) });
const tok = (key: string, label: string, help?: string): FieldDescriptor => ({ key, label, group: "", input: "token", required: true, ...(help ? { help } : {}) });
const ln = (key: string, label: string, help?: string): FieldDescriptor => ({ key, label, group: "", input: "line", required: true, ...(help ? { help } : {}) });

const ACTION_POINT_COST: FieldDescriptor = {
  key: "actionPointCost", label: "AP cost", group: "Cost", input: "variant", discriminator: "model", vocabulary: "actionCostModels", required: true,
  help: "Fixed amount, a range, a minimum, decided by what is used (a Spell or Skill Action), or none.",
  variants: {
    FIXED: [n("amount", "AP amount")],
    RANGE: [n("minimum", "Minimum AP"), n("maximum", "Maximum AP")],
    MINIMUM: [n("minimum", "Minimum AP")],
    VARIABLE: [sel("determinedBy", "Decided by", "variableCostDeterminers")],
    NONE: [],
  },
};
const ROLL_SHAPE: readonly FieldDescriptor[] = [
  { key: "naturalSelection", label: "Natural result by roll mode", group: "", input: "byVocabulary", vocabulary: "rollModes", required: true, fields: [ln("expression", "Selection", "Uses r1 and r2, for example max(r1, r2).")], help: "How the natural result is read from the dice for each roll mode." },
  { key: "total", label: "Total", group: "", input: "coreFormula", sources: "rollFormulaSourceKinds", required: true },
  { key: "bonusTarget", label: "Explicit bonuses apply to", group: "", input: "nullableSelect", vocabulary: "bonusTargets", required: false },
  { key: "comparison", label: "Compared with", group: "", input: "group", required: true, fields: [ln("operator", "Operator"), tok("against", "Against", "The difficulty the total is compared with.")] },
  { key: "critical", label: "Critical rule", group: "", input: "group", nullable: true, required: false, fields: [tok("threat", "Threat"), tok("hit", "Hit"), tok("damage", "Damage")] },
  flag("requiresSkill", "Requires a Skill"),
  { key: "source", label: "Source", group: "", input: "source", required: true },
];

export const REMAINING_KIND_DESCRIPTORS: Readonly<Record<string, ContractDescriptor>> = {
  ACTION: {
    purpose: "An Action a Character can take: when it can be used, its AP cost and any other costs, the movement it grants and whether a trigger is required.",
    fields: [
      { ...tok("actionKey", "Action"), group: "Identity" },
      { key: "timing", label: "When", group: "Identity", input: "select", vocabulary: "actionTimings", required: true },
      ACTION_POINT_COST,
      { key: "otherCosts", label: "Other costs", group: "Cost", input: "list", itemLabel: "Cost", required: false, item: [tok("costKey", "Cost"), sel("policy", "Paid as", "paymentPolicies"), n("amount", "Amount")] },
      { key: "movementGrant", label: "Movement granted", group: "Movement", input: "group", nullable: true, required: false, fields: [{ key: "formula", label: "Distance", group: "", input: "coreFormula", sources: "movementGrantSourceKinds", required: true }] },
      { ...flag("requiresTrigger", "Requires a trigger"), group: "Rules" },
      { ...flag("costOverridableByExplicitRule", "An explicit rule may change its cost"), group: "Rules" },
      { key: "rules", label: "Rule notes", group: "Rules", input: "authoredData", required: true },
      { key: "source", label: "Source", group: "Source", input: "source", required: true },
    ],
  },
  RESOURCE: {
    purpose: "A runtime Resource (HP, MP, AP …): its kind, bounds, when it refreshes or expires, how it is spent and restored, and how costs are paid from it.",
    fields: [
      { key: "resourceKey", label: "Resource", group: "Identity", input: "select", vocabulary: "runtimeResourceKeys", required: true },
      { key: "m4Kind", label: "Engine resource kind", group: "Identity", input: "select", vocabulary: "resourceKinds", required: true },
      { ...n("minimum", "Minimum"), group: "Bounds" },
      { key: "maximum", label: "Maximum", group: "Bounds", input: "variant", discriminator: "source", vocabulary: "resourceMaximumSources", required: true, variants: { DERIVED: [sel("statistic", "Calculated value", "derivedStatistics")], UNBOUNDED: [] } },
      { key: "refresh", label: "Refresh", group: "Timing", input: "list", itemLabel: "Refresh", required: false, item: [sel("timing", "When", "combatTimingEvents"), sel("target", "Refresh to", "resourceRefreshTargets")] },
      { key: "expiry", label: "Expiry", group: "Timing", input: "list", itemLabel: "Expiry", required: false, item: [sel("timing", "When", "combatTimingEvents"), sel("setTo", "Set to", "resourceExpiryTargets"), flag("preservableByExplicitRule", "An explicit rule may preserve it")] },
      { key: "spending", label: "Spending", group: "Use", input: "select", vocabulary: "resourceSpending", required: true },
      { key: "restoration", label: "Restoration", group: "Use", input: "group", nullable: true, required: false, fields: [sel("ceiling", "Up to", "resourceCeilings"), sel("overflow", "Overflow", "resourceOverflowPolicies")] },
      { ...flag("supportsReservation", "Supports reservation"), group: "Use" },
      { key: "payment", label: "Pays", group: "Use", input: "list", itemLabel: "Payment", required: false, item: [sel("policy", "Policy", "paymentPolicies"), n("order", "Order")] },
      { key: "usageRestrictions", label: "Usage restrictions", group: "Use", input: "list", itemLabel: "Restriction", required: false, item: [sel("restrictionKey", "Restriction", "resourceUsageRestrictions"), n("throughRound", "Through round")] },
      { ...flag("exposesDepletion", "Reports when depleted"), group: "Use" },
      { key: "rules", label: "Rule notes", group: "Rules", input: "authoredData", required: true },
      { key: "source", label: "Source", group: "Source", input: "source", required: true },
    ],
  },
  ACTION_IMPROVEMENT: {
    purpose: "An improvement to one exact Action: who may take it (prerequisites) and what it changes (modifications).",
    fields: [
      { ...tok("improvementKey", "Improvement"), group: "Identity" },
      { key: "action", label: "Improves Action", group: "Identity", input: "reference", refKind: "ACTION", required: true },
      { key: "rulesText", label: "Rules text", group: "Identity", input: "text", required: true },
      {
        key: "prerequisites", label: "Prerequisites", group: "Prerequisites", input: "list", itemLabel: "Prerequisite", required: false,
        item: [{ key: "", label: "Prerequisite", group: "", input: "variant", discriminator: "kind", vocabulary: "actionImprovementPrerequisites", required: true, variants: {
          LEVEL_AT_LEAST: [tok("prerequisiteKey", "Key"), n("minimum", "Minimum Level")],
          STAT_AT_LEAST: [tok("prerequisiteKey", "Key"), sel("stat", "Stat", "prowessStats"), n("minimum", "Minimum")],
          SKILL_RANK_AT_LEAST: [tok("prerequisiteKey", "Key"), ln("skillKey", "Skill (canonical key)"), tok("minimumRank", "Minimum rank")],
          AFFINITY_RANK_AT_LEAST: [tok("prerequisiteKey", "Key"), { key: "affinity", label: "Affinity", group: "", input: "reference", refKind: "AFFINITY", required: true }, sel("minimumRank", "Minimum rank", "affinityRanks")],
        } }],
      },
      {
        key: "modifications", label: "Modifications", group: "Modifications", input: "list", itemLabel: "Modification", required: true,
        item: [{ key: "", label: "Modification", group: "", input: "variant", discriminator: "kind", vocabulary: "actionImprovementModifications", required: true, variants: {
          ACTION_POINT_COST: [tok("modificationKey", "Key"), { key: "rulesText", label: "Rules text", group: "", input: "text", required: true }, { key: "condition", label: "Only when (advanced requirement)", group: "", input: "optionalData", required: false }, { key: "actionPointCost", label: "New AP cost", group: "", input: "group", required: true, fields: [ln("model", "Model"), n("amount", "AP amount")] }],
          ADDITIONAL_USE_CASE: [tok("modificationKey", "Key"), { key: "rulesText", label: "Rules text", group: "", input: "text", required: true }, { key: "condition", label: "Only when (advanced requirement)", group: "", input: "optionalData", required: false }, tok("useCaseKey", "Use case")],
          RULE_OPERATION: [tok("modificationKey", "Key"), { key: "rulesText", label: "Rules text", group: "", input: "text", required: true }, { key: "condition", label: "Only when (advanced requirement)", group: "", input: "optionalData", required: false }, tok("operationKey", "Operation"), { key: "data", label: "Operation data", group: "", input: "authoredData", required: true }],
        } }],
      },
      { key: "source", label: "Source", group: "Source", input: "source", required: true },
    ],
  },
  AFFINITY_RANK_RULE: {
    purpose: "Affinity Ranks in order: each rank's Strength discount and the Spell authority (Effect / Trait capacity) it grants.",
    fields: [
      {
        key: "ranks", label: "Ranks", group: "Ranks", input: "list", itemLabel: "Rank", required: true,
        item: [sel("rank", "Rank", "affinityRanks"), n("order", "Order"), n("strengthDiscountPercent", "Strength discount (%)"), { key: "authority", label: "Authority granted", group: "", input: "group", nullable: true, required: false, fields: [n("effectCapacity", "Effect capacity"), n("traitCapacity", "Trait capacity")] }],
      },
      { key: "authorityMinimumRank", label: "Lowest rank granting authority", group: "Ranks", input: "select", vocabulary: "affinityRanks", required: true },
      { key: "source", label: "Source", group: "Source", input: "source", required: true },
    ],
  },
  // PRE-M7-WO1: MAGE_ART v1 — authoring and reference only (nothing executes a Mage Art; the Character card stays unavailable).
  MAGE_ART: {
    purpose: "A Mage Art: one fixed discipline (never built from Spell components). Records its activation and per-turn maintenance costs, when it counts as an Active Effect, and any modes. What the Art does is written in the description and each mode's rules text — reference only; it is not executed or priced for play.",
    fields: [
      tok("artKey", "Art key", "A unique UPPER_SNAKE name, e.g. BARRIER."),
      { key: "activation", label: "Activation cost", group: "Costs", input: "group", required: true, fields: [n("ap", "AP amount"), n("mp", "MP amount")], help: "AP and MP spent to activate the Art." },
      {
        key: "maintenance", label: "Maintenance (each turn)", group: "Costs", input: "group", required: true,
        fields: [n("ap", "AP amount"), n("mp", "MP amount"), { key: "special", label: "Special cost (optional)", group: "", input: "text", nullable: true, required: false, help: "A maintenance cost that is not AP or MP, exactly as the rules state it. Leave empty when there is none." }],
        help: "Paid at the start of each of the user's turns; the Art ends if it is not paid.",
      },
      { key: "activeEffect", label: "Counts as an Active Effect", group: "Costs", input: "group", required: true, fields: [sel("counts", "When", "mageArtActiveEffectWindows")] },
      {
        key: "modes", label: "Modes", group: "Modes", input: "list", itemLabel: "Mode", required: false, help: "Leave empty when the Art has no modes. A mode with no own costs uses the Art's costs.",
        item: [
          tok("modeKey", "Mode key"),
          ln("name", "Name"),
          { key: "activation", label: "Own activation cost", group: "", input: "group", nullable: true, required: false, fields: [n("ap", "AP amount"), n("mp", "MP amount")] },
          { key: "maintenance", label: "Own maintenance", group: "", input: "group", nullable: true, required: false, fields: [n("ap", "AP amount"), n("mp", "MP amount"), { key: "special", label: "Special cost (optional)", group: "", input: "text", nullable: true, required: false }] },
          { key: "rulesText", label: "Rules text", group: "", input: "text", required: true },
        ],
      },
      SOURCE,
    ],
  },
  AFFINITY_PROGRESSION: {
    purpose: "When Characters gain or improve Affinities: for each Level, whether the step is required or a choice, and its options.",
    fields: [
      {
        key: "levels", label: "Levels", group: "Progression", input: "list", itemLabel: "Level step", required: true,
        item: [
          n("level", "Level"),
          sel("mode", "Mode", "affinityProgressionModes"),
          { key: "options", label: "Options", group: "", input: "list", itemLabel: "Option", required: true, item: [{ key: "", label: "Option", group: "", input: "variant", discriminator: "action", vocabulary: "affinityAdvancementActions", required: true, variants: {
            CHOOSE_PRIMARY_AFFINITY: [tok("optionKey", "Option"), sel("startingRank", "Starting rank", "affinityRanks")],
            RANK_UP: [tok("optionKey", "Option"), sel("target", "Which Affinity", "affinityRankUpTargets"), sel("from", "From rank", "affinityRanks"), sel("to", "To rank", "affinityRanks")],
            GAIN_AFFINITY: [tok("optionKey", "Option"), sel("role", "Role", "affinityRoles"), sel("startingRank", "Starting rank", "affinityRanks"), { key: "conflictKey", label: "Conflict key (optional)", group: "", input: "line", required: false }],
          } }] },
        ],
      },
      { key: "source", label: "Source", group: "Source", input: "source", required: true },
    ],
  },
  CORE_RESOLUTION: {
    purpose: "A core procedure (a roll, Stat Mastery or Initiative): how the natural result is read, how the total is calculated and what it is compared with.",
    fields: [
      {
        key: "", label: "Procedure", group: "Procedure", input: "variant", discriminator: "procedure", vocabulary: "coreProcedures", required: true,
        variants: {
          CORE_ROLL: ROLL_SHAPE, SKILL_CHECK: ROLL_SHAPE, SKILL_AUTOMATIC_SUCCESS: ROLL_SHAPE, SAVING_THROW: ROLL_SHAPE, ATTACK_ROLL: ROLL_SHAPE,
          STAT_MASTERY: [
            { key: "mastery", label: "Mastery", group: "", input: "group", required: true, fields: [n("levelAtLeast", "From Level"), n("statAtLeast", "When the Stat is at least"), ln("signal", "Grants")] },
            { key: "appliesTo", label: "Applies to rolls", group: "", input: "multiSelect", vocabulary: "rollProcedures", required: true },
            { key: "source", label: "Source", group: "", input: "source", required: true },
          ],
          INITIATIVE: [
            ROLL_SHAPE[0] as FieldDescriptor,
            { key: "total", label: "Total", group: "", input: "coreFormula", sources: "initiativeFormulaSourceKinds", required: true },
            ROLL_SHAPE[2] as FieldDescriptor,
            { key: "tiebreak", label: "Tie-breaks in order", group: "", input: "list", itemLabel: "Tie-break", required: true, item: [{ key: "", label: "Tie-break", group: "", input: "variant", discriminator: "kind", vocabulary: "initiativeTiebreakKinds", required: true, variants: { HIGHEST_STAT: [sel("stat", "Stat", "prowessStats")], REROLL: [] } }] },
            { key: "source", label: "Source", group: "", input: "source", required: true },
          ],
        },
      },
    ],
  },
  ABILITY_CONSTRUCTION_RULE: {
    purpose: "How Spells and Maneuvers are built: slot formulas, the Arcane and Martial capacity tracks, Signature Ability slots and Trait exchanges. Engine policies stay available as advanced data.",
    fields: [
      { ...tok("rankLadder", "Rank ladder", "The Skill rank ladder the capacity tracks read."), group: "General" },
      {
        key: "formulas", label: "Construction formulas", group: "Formulas", input: "group", required: true,
        fields: ["remainingEffects", "effectiveTraits", "maximumTrades", "signatureProjected", "signatureAvailable"].map((slot) => ({
          key: slot, label: slot.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()), group: "", input: "group" as const, required: true,
          fields: [ln("expression", "Expression"), { key: "rounding", label: "Rounding", group: "", input: "select" as const, vocabulary: "formulaRoundings" as const, required: true }, { key: "minimum", label: "Minimum (optional)", group: "", input: "integer" as const, required: false }, { key: "variables", label: "Inputs it reads", group: "", input: "textList" as const, required: true }],
        })),
      },
      {
        key: "spell", label: "Spell construction", group: "Spells", input: "group", required: true,
        fields: [
          { key: "arcaneAuthority", label: "Arcane Authority track", group: "", input: "group", required: true, fields: [ln("skillKey", "Skill (canonical key)"), tok("minimumRank", "Minimum rank"), { key: "ranks", label: "Capacity by rank", group: "", input: "rows", itemLabel: "rank", required: true, columns: [{ key: "rankKey", label: "Rank", type: "token" }, { key: "effectCapacity", label: "Effects", type: "integer" }, { key: "traitCapacity", label: "Traits", type: "integer" }] }] },
          { key: "affinityAuthority", label: "Affinity Authority", group: "", input: "group", required: true, fields: [tok("capacitySource", "Capacity from")] },
          { key: "castingConditions", label: "Casting Conditions", group: "", input: "group", required: true, fields: [tok("capacitySource", "Capacity from"), { key: "ranks", label: "Capacity by rank", group: "", input: "rows", itemLabel: "rank", required: true, columns: [{ key: "rankKey", label: "Rank", type: "token" }, { key: "capacity", label: "Capacity", type: "integer" }] }] },
          n("minimumEffects", "Minimum Effects"),
          { key: "traitExchange", label: "Trait exchange", group: "", input: "group", nullable: true, required: false, fields: [n("effectSlotsPerExchange", "Effect slots given up"), n("traitSlotsPerExchange", "Trait slots gained"), n("minimumEffectsRemaining", "Effects that must remain")] },
        ],
      },
      {
        key: "maneuver", label: "Maneuver construction", group: "Maneuvers", input: "group", required: true,
        fields: [
          { key: "martial", label: "Martial track", group: "", input: "group", required: true, fields: [ln("skillKey", "Skill (canonical key)"), tok("minimumRank", "Minimum rank"), { key: "ranks", label: "By rank", group: "", input: "rows", itemLabel: "rank", required: true, columns: [{ key: "rankKey", label: "Rank", type: "token" }, { key: "martialRankValue", label: "Rank value", type: "integer" }, { key: "effectCapacity", label: "Effects", type: "integer" }, { key: "traitCapacity", label: "Traits", type: "integer" }, { key: "conditionCapacity", label: "Conditions", type: "integer" }] }] },
          n("minimumEffects", "Minimum Effects"),
          flag("foundationRequired", "A foundation is required"),
          { key: "traitExchange", label: "Trait exchange", group: "", input: "group", nullable: true, required: false, fields: [n("effectSlotsPerExchange", "Effect slots given up"), n("traitSlotsPerExchange", "Trait slots gained"), n("minimumEffectsRemaining", "Effects that must remain")] },
        ],
      },
      {
        key: "signature", label: "Signature Abilities", group: "Signature", input: "group", required: true,
        fields: [sel("capacityStatistic", "Slots from", "derivedStatistics"), n("defaultSlotCost", "Slots per ability"), n("exemptSlotCost", "Slots per exempt ability"), { key: "exemptions", label: "Exemptions", group: "", input: "list", itemLabel: "Exemption", required: false, item: [tok("exemptionKey", "Exemption"), { key: "description", label: "Rule it represents", group: "", input: "text", required: true }] }],
      },
      { key: "conditionPolicy", label: "Condition policy (advanced)", group: "Advanced engine policies", input: "optionalData", required: false, help: "Additive engine policy data; absent in older rules. Edited as structured data." },
      { key: "maneuverCostPolicy", label: "Maneuver cost policy (advanced)", group: "Advanced engine policies", input: "optionalData", required: false },
      { key: "effectExecutionPolicy", label: "Effect execution policy (advanced)", group: "Advanced engine policies", input: "optionalData", required: false },
      { key: "activeMagicPolicy", label: "Active Magic policy (advanced)", group: "Advanced engine policies", input: "optionalData", required: false },
      { key: "source", label: "Source", group: "Source", input: "source", required: true },
    ],
  },
};

/** Version-2 AFFINITY authoring: identity, themes, and the Keyword-matched Strengths and Weaknesses. */
const AFFINITY_V2: ContractDescriptor = {
  purpose: "An Affinity: its identity and themes, and the Strengths and Weaknesses that match Keywords. Weakness penalties are percentages of the activation cost.",
  fields: [
    { key: "affinity", label: "Affinity", group: "Identity", input: "select", vocabulary: "canonicalAffinities", required: true },
    { key: "identity", label: "Identity", group: "Identity", input: "group", required: true, fields: [{ key: "text", label: "Identity text", group: "", input: "text", required: true }, { key: "themes", label: "Themes", group: "", input: "textList", required: true }] },
    { key: "strengths", label: "Strengths", group: "Strengths & Weaknesses", input: "list", itemLabel: "Strength", required: false, item: [tok("strengthKey", "Strength"), { key: "matchAny", label: "Matches any Keyword", group: "", input: "textList", required: true }] },
    { key: "weaknesses", label: "Weaknesses", group: "Strengths & Weaknesses", input: "list", itemLabel: "Weakness", required: false, item: [tok("weaknessKey", "Weakness"), { key: "matchAny", label: "Matches any Keyword", group: "", input: "textList", required: true }, n("activationPenaltyPercent", "Activation penalty (%)"), { key: "severity", label: "Severity", group: "", input: "nullableSelect", vocabulary: "weaknessSeverities", required: false }] },
    { key: "source", label: "Source", group: "Source", input: "source", required: true },
  ],
};

/**
 * RULES-WO1: authored rules in game language. The M5 readers (definition/rules-authoring-payload.ts) validate every
 * value; the preview evaluates the saved Draft with the same code the Character sheet uses.
 */
const RULE_SOURCE: FieldDescriptor = { key: "source", label: "Source", group: "Source", input: "optionalSource", required: false, help: "Cite the rulebook sections this comes from. Required when the rule is canonical." };
const CANON: FieldDescriptor = { key: "canonStatus", label: "Where this rule comes from", group: "Status", input: "select", vocabulary: "canonStatuses", required: true, help: "Canonical = stated in the rulebook. Owner provided = a designer ruling. Test only = a labelled placeholder that is never presented as canon." };
const NOTE: FieldDescriptor = { key: "note", label: "Why it is not canonical", group: "Status", input: "text", nullable: true, required: false, help: "Required for owner-provided and test-only rules: the ruling, or what is missing from the source." };
const formulaField = (key: string, label: string, sources: VocabularyName, help: string): FieldDescriptor => ({ key, label, group: "Calculation", input: "coreFormula", sources, required: true, help });
export const RULES_AUTHORING_DESCRIPTORS: Readonly<Record<string, ContractDescriptor>> = {
  CALCULATED_VALUE: {
    preview: "AUTHORED_RULE",
    purpose: "A game value calculated from a Character — for example Carry Capacity from Strength. Skill benefits can add to it, and it can be shown on the Character sheet.",
    fields: [
      { key: "valueKey", label: "Value name used by other rules", group: "Identity", input: "token", fromName: true, required: true, placeholder: "CARRY_CAPACITY", help: "Filled in from the Display Name. Other rules use it to add to this value." },
      { key: "unit", label: "Unit", group: "Identity", input: "text", nullable: true, required: false, help: "For example lb or ft." },
      { key: "placement", label: "Shown on the Character sheet as", group: "Identity", input: "select", vocabulary: "calculatedValuePlacements", required: true },
      { key: "base", label: "Base calculation", group: "Calculation", input: "optionalFormula", sources: "valueBaseSourceKinds", presetFromStat: true, required: false, presentLabel: "The rule states a base calculation", absentLabel: "The rulebook does not state a base value (only bonuses are added)", help: "Each contribution reads a Stat, the Character's Level or another statistic." },
      CANON,
      NOTE,
      RULE_SOURCE,
    ],
  },
  SKILL_BENEFIT: {
    preview: "AUTHORED_RULE",
    purpose: "Something a Skill grants from a rank onward — for example Athletics at Trained adds 5 ft of Throw Distance per point of Strength.",
    fields: [
      { key: "benefitKey", label: "Benefit name", group: "Identity", input: "token", fromName: true, required: true, placeholder: "ATHLETICS_TRAINED_THROW" },
      { key: "skill", label: "Skill", group: "When it applies", input: "reference", refKind: "SKILL", required: true },
      { key: "minimumRankKey", label: "From rank", group: "When it applies", input: "contentToken", options: "skillRanks", required: true, help: "The benefit applies at this rank and every higher rank." },
      { key: "writtenBenefit", label: "The benefit as written", group: "Benefit", input: "text", required: true },
      {
        key: "contributions",
        label: "Adds to values",
        group: "Benefit",
        input: "list",
        itemLabel: "Addition",
        required: false,
        item: [
          { key: "contributionKey", label: "Addition name", group: "", input: "token", required: true, placeholder: "PER_STR" },
          { key: "valueKey", label: "Adds to the value", group: "", input: "contentToken", options: "calculatedValues", required: true },
          { key: "amount", label: "Amount", group: "", input: "coreFormula", sources: "benefitAmountSourceKinds", required: true },
        ],
      },
      { key: "grantedActions", label: "Grants Actions", group: "Benefit", input: "refList", refKind: "ACTION", itemLabel: "Action", required: false },
      { key: "source", label: "Source", group: "Source", input: "source", required: true },
    ],
  },
  CONCENTRATION_RULE: {
    preview: "AUTHORED_RULE",
    purpose: "How Concentration works: how many points a Character has, what a Sustained Spell costs to keep up each round, and how assigned points cover that cost. Reference and preview only — combat does not read this rule yet.",
    fields: [
      { key: "ruleKey", label: "Rule name", group: "Identity", input: "token", fromName: true, required: true, placeholder: "CONCENTRATION" },
      formulaField("capacity", "Concentration points", "concentrationCapacitySourceKinds", "How many Concentration points a Character has."),
      formulaField("sustainedSpellUpkeepAp", "Sustained Spell upkeep (AP per round)", "concentrationUpkeepSourceKinds", "The AP a Sustained Spell costs each round, from the AP it cost to cast."),
      {
        key: "allocation",
        label: "Assigning points",
        group: "Assigning points",
        input: "group",
        required: true,
        fields: [
          { key: "apCoveredPerPoint", label: "AP of upkeep one point covers", group: "", input: "integer", required: true },
          { key: "maySplitAcrossEffects", label: "Points may be split across Effects", group: "", input: "boolean", required: true },
          { key: "mayStackOnOneEffect", label: "Several points may be placed on one Effect", group: "", input: "boolean", required: true },
          { key: "uncoveredApPaid", label: "Upkeep AP not covered is still paid", group: "", input: "boolean", required: true },
          { key: "waivesMpUpkeep", label: "Points also waive MP upkeep", group: "", input: "boolean", required: true },
          { key: "waivesManaLock", label: "Points also waive Mana Lock", group: "", input: "boolean", required: true },
          { key: "pointsReturnWhenEffectEnds", label: "Points return when the Effect ends", group: "", input: "boolean", required: true },
        ],
      },
      { key: "openQuestions", label: "Open questions", group: "Open questions", input: "list", itemLabel: "Question", required: false, item: [tok("questionKey", "Short name"), { key: "question", label: "Question", group: "", input: "text", required: true }] },
      CANON,
      NOTE,
      RULE_SOURCE,
    ],
  },
};

/**
 * RULES-WO1 Phase C: the remaining rule families, in game language. Each is authored, validated by its M5 reader and
 * shown in the Rules Reference; the entry page states that none of them is executed in play yet.
 */
const idTok = (key: string, label: string, placeholder: string): FieldDescriptor => ({ key, label, group: "Identity", input: "token", required: true, placeholder, fromName: true, help: "Filled in from the Display Name; change it only if two entries would share a name." });
const txt = (key: string, label: string, group: string, help?: string): FieldDescriptor => ({ key, label, group, input: "text", required: true, ...(help ? { help } : {}) });
const txtList = (key: string, label: string, group: string, help?: string): FieldDescriptor => ({ key, label, group, input: "textList", required: false, ...(help ? { help } : {}) });
const optInt = (key: string, label: string, group: string, help?: string): FieldDescriptor => ({ key, label, group, input: "integer", required: false, ...(help ? { help } : {}) });
export const REFERENCE_FAMILY_DESCRIPTORS: Readonly<Record<string, ContractDescriptor>> = {
  ARMOR: {
    preview: "SAMPLE_INPUTS",
    previewSample: "SHEET",
    purpose: "A suit of worn Armor: its category, the Armor it grants, the Strength it needs and what it costs in Dodge, Movement and Stealth. Reference and preview — the Character sheet does not equip worn Armor yet.",
    fields: [
      idTok("armorKey", "Armor name used by other rules", "TACTICAL_PLATING"),
      { key: "category", label: "Category", group: "Protection", input: "select", vocabulary: "armorCategories", required: true },
      { key: "armorValue", label: "Armor granted", group: "Protection", input: "integer", required: true },
      optInt("strengthRequirement", "Strength required (leave empty for none)", "Requirements"),
      optInt("maxAgiForDodge", "Most AGI that counts toward Dodge (leave empty for no limit)", "Limits"),
      { key: "movementPenaltyFeet", label: "Movement penalty (feet)", group: "Limits", input: "integer", required: true },
      { key: "stealth", label: "Stealth", group: "Limits", input: "select", vocabulary: "stealthEffects", required: true },
      txtList("notes", "Notes", "Limits"),
      { key: "source", label: "Source", group: "Source", input: "source", required: true },
    ],
  },
  STATUS_CONDITION: {
    purpose: "A Condition placed on a creature (Burning, Stunned …): what it does, how long it lasts, how it is removed, when it acts and whether it stacks. Reference — play does not apply Conditions yet.",
    fields: [
      idTok("conditionKey", "Condition name used by other rules", "BURNING"),
      { key: "effects", label: "What it does", group: "Effect", input: "list", itemLabel: "Effect", required: true, item: [tok("effectKey", "Short name"), { key: "text", label: "Effect", group: "", input: "text", required: true }] },
      {
        key: "duration", label: "How long it lasts", group: "Duration", input: "group", required: true,
        fields: [sel("model", "Lasts", "conditionDurationModels"), { key: "rounds", label: "Number of rounds (only for a number of rounds)", group: "", input: "integer", required: false }, { key: "text", label: "Description (needed for a special duration)", group: "", input: "text", nullable: true, required: false }],
      },
      { key: "removal", label: "How it is removed", group: "Duration", input: "textList", required: true, help: "At least one way to end it." },
      { key: "ongoingTiming", label: "When it acts", group: "Duration", input: "select", vocabulary: "conditionOngoingTimings", required: true },
      { key: "stacking", label: "Stacking", group: "Duration", input: "select", vocabulary: "conditionStacking", required: true },
      { key: "source", label: "Source", group: "Source", input: "source", required: true },
    ],
  },
  SUMMON_TYPE: {
    preview: "SAMPLE_INPUTS",
    previewSample: "TIERED_SHEET",
    purpose: "One Summon engine (Summon Entity, Totem, Persistent Construct, Bound Summon, Manifested Entity, Fusion or Equipment Summoning): its tier table, costs, sustain and limits. Reference and cost preview — no Summon is created or played yet.",
    fields: [
      idTok("summonKey", "Engine name used by other rules", "MY_TOTEM"),
      { key: "engine", label: "Engine", group: "Identity", input: "select", vocabulary: "summonEngines", required: true },
      {
        key: "tiers", label: "Tiers", group: "Tiers", input: "list", itemLabel: "Tier", required: true,
        item: [tok("tierKey", "Tier name"), ln("label", "Label"), optInt("baseMp", "Base MP", ""), optInt("dieFaces", "Die (faces)", ""), optInt("staticValue", "Static value", ""), optInt("hp", "Hit points (HP)", ""), optInt("armor", "Armor", ""), optInt("resolve", "Resolve", ""), optInt("radiusFeet", "Radius (feet)", ""), { key: "size", label: "Size", group: "", input: "text", nullable: true, required: false }, optInt("traitSlots", "Trait slots", "")],
      },
      { key: "castingAp", label: "Casting AP", group: "Costs", input: "optionalFormula", sources: "summonCostSourceKinds", required: false, presentLabel: "Casting AP is calculated", absentLabel: "The rulebook states no casting AP for this engine" },
      { key: "sustainMode", label: "Sustain", group: "Costs", input: "select", vocabulary: "summonSustainModes", required: true },
      { key: "sustainMp", label: "Sustain MP each round", group: "Costs", input: "optionalFormula", sources: "summonCostSourceKinds", required: false, presentLabel: "Sustain MP is calculated", absentLabel: "No sustain MP" },
      optInt("sustainApPerRound", "Sustain AP each round (leave empty for none)", "Costs"),
      { key: "countsTowardConcentration", label: "Counts toward Concentration", group: "Costs", input: "triState", required: false, yes: "Yes", no: "No", unknown: "Not decided (open question)" },
      { key: "maxActive", label: "Most active at once", group: "Limits", input: "optionalFormula", sources: "summonLimitSourceKinds", required: false, presentLabel: "Calculated from the caster's Stats", absentLabel: "No stated limit" },
      txt("actionEconomy", "How it acts", "Limits"),
      txtList("restrictions", "Restrictions", "Limits"),
      txtList("openQuestions", "Open questions", "Limits"),
      { key: "source", label: "Source", group: "Source", input: "source", required: true },
    ],
  },
  SUMMON_TRAIT: {
    purpose: "A trait a Summon engine can take: which engines, what it costs per tier, and what it does. Reference — no Summon is created or played yet.",
    fields: [
      idTok("traitKey", "Trait name used by other rules", "WARDING_PULSE"),
      { key: "engines", label: "Engines that can take it", group: "Access", input: "multiSelect", vocabulary: "summonEngines", required: true },
      { key: "costs", label: "Cost per tier", group: "Access", input: "list", itemLabel: "Cost", required: false, item: [tok("tierKey", "Tier name"), n("mp", "MP cost")] },
      { ...flag("forbidden", "Forbidden trait"), group: "Access" },
      txt("effect", "What it does", "Effect"),
      { key: "source", label: "Source", group: "Source", input: "source", required: true },
    ],
  },
  MISSION_RULE: {
    preview: "SAMPLE_INPUTS",
    previewSample: "ROLL_OR_CLOCK",
    purpose: "A GM / Mission rule: a die-range table (every roll must be covered), a Threat Clock with its escalation points, an Intel token or a written reference rule. Reference and preview — nothing generates or runs a Mission yet.",
    fields: [{ key: "", label: "Mission rule", group: "Rule", input: "missionRule", nameKey: "ruleKey", required: true }],
  },
  REFERENCE_RULE: {
    preview: "SAMPLE_INPUTS",
    previewSample: "ROLL_OR_CLOCK",
    purpose: "A written gameplay rule: a die-range table (difficulty, critical results, cover …) or rule points (grappling, flanking …). Reference and table preview — nothing calculates from it.",
    fields: [{ key: "", label: "Gameplay rule", group: "Rule", input: "missionRule", shapes: "referenceRuleShapes", nameKey: "ruleKey", required: true }],
  },
  METAMAGIC: {
    purpose: "A Metamagic option or trait: its cost, what it does and its restrictions. Reference — the Spell builder does not offer Metamagic yet.",
    fields: [
      idTok("metamagicKey", "Metamagic name used by other rules", "EXTEND"),
      { key: "form", label: "Form", group: "Identity", input: "select", vocabulary: "metamagicForms", required: true },
      optInt("mp", "MP cost (leave empty if none)", "Cost"),
      optInt("ap", "AP cost (leave empty if none)", "Cost"),
      { key: "otherCost", label: "Other cost, as written", group: "Cost", input: "text", nullable: true, required: false },
      txt("effect", "What it does", "Effect"),
      txtList("restrictions", "Restrictions", "Effect"),
      { key: "source", label: "Source", group: "Source", input: "source", required: true },
    ],
  },
  JOB_TEMPLATE: {
    purpose: "An optional Job Class template (Warrior, Thief, Mage …): its role, suggested Stats and Skills, starting gear and features. Reference — Character creation does not offer Job templates yet.",
    fields: [
      idTok("jobKey", "Job name used by other rules", "WARRIOR"),
      txt("role", "Role", "Identity"),
      { key: "suggestedStats", label: "Suggested Stats", group: "Suggestions", input: "multiSelect", vocabulary: "prowessStats", required: false },
      { key: "suggestedSkills", label: "Suggested Skills", group: "Suggestions", input: "refList", refKind: "SKILL", itemLabel: "Skill", required: false },
      txtList("startingEquipment", "Starting equipment", "Suggestions"),
      txtList("features", "Features", "Suggestions"),
      { key: "source", label: "Source", group: "Source", input: "source", required: true },
    ],
  },
};

/** RULES-WO1: MAGE_ART version 2 = version 1 plus per-mode scaling steps, granted benefits and maintenance exceptions. */
const MAGE_ART_KIND = Object.keys(REMAINING_KIND_DESCRIPTORS).find((k) => REMAINING_KIND_DESCRIPTORS[k]!.fields.some((f) => f.key === "artKey")) ?? "";
const MAGE_ART_V1 = REMAINING_KIND_DESCRIPTORS[MAGE_ART_KIND] ?? null;
const MAGE_ART_V2_DESCRIPTOR: ContractDescriptor | null =
  MAGE_ART_V1 === null
    ? null
    : {
        purpose: `${MAGE_ART_V1.purpose} Version 2 also records how each mode scales and the benefits and maintenance exceptions of the Art.`,
        fields: [
          ...MAGE_ART_V1.fields.map((f): FieldDescriptor =>
            f.key === "modes" && f.input === "list"
              ? { ...f, item: [...f.item, { key: "scaling", label: "Scaling steps", group: "", input: "list", itemLabel: "Step", required: false, item: [tok("stepKey", "Step name"), ln("label", "Label"), { key: "text", label: "What changes", group: "", input: "text", required: true }] }] }
              : f,
          ).filter((f) => f.key !== "source"),
          { key: "grantedBenefits", label: "Benefits it grants", group: "Benefits", input: "textList", required: false },
          { key: "maintenanceExceptions", label: "Maintenance exceptions", group: "Benefits", input: "textList", required: false },
          ...MAGE_ART_V1.fields.filter((f) => f.key === "source"),
        ],
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
  if (schemaVersion === 1 && REMAINING_KIND_DESCRIPTORS[kind.definitionKind] !== undefined) return REMAINING_KIND_DESCRIPTORS[kind.definitionKind] as ContractDescriptor;
  if (kind.definitionKind === "AFFINITY" && schemaVersion === 2) return AFFINITY_V2;
  if (schemaVersion === 1 && ABILITY_DEFINITION_DESCRIPTORS[kind.definitionKind] !== undefined) return ABILITY_DEFINITION_DESCRIPTORS[kind.definitionKind] as ContractDescriptor;
  if (schemaVersion === 1 && RUNTIME_KIND_DESCRIPTORS[kind.definitionKind] !== undefined) return RUNTIME_KIND_DESCRIPTORS[kind.definitionKind] as ContractDescriptor;
  if (kind.definitionKind === "AFFINITY" && schemaVersion === 1) return AFFINITY_V1;
  if (schemaVersion === 1 && RULES_AUTHORING_DESCRIPTORS[kind.definitionKind] !== undefined) return RULES_AUTHORING_DESCRIPTORS[kind.definitionKind] as ContractDescriptor;
  if (schemaVersion === 1 && REFERENCE_FAMILY_DESCRIPTORS[kind.definitionKind] !== undefined) return REFERENCE_FAMILY_DESCRIPTORS[kind.definitionKind] as ContractDescriptor;
  if (schemaVersion === 2 && MAGE_ART_V2_DESCRIPTOR !== null && kind.definitionKind === MAGE_ART_KIND) return MAGE_ART_V2_DESCRIPTOR;
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
      return field.nullable ? null : "";
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
    case "abilityDefinition":
      return initialAbilityPayload(field.branch);
    case "group":
      return field.nullable ? null : Object.fromEntries(field.fields.map((f) => [f.key, initialFieldValue(f)]));
    case "list":
    case "multiSelect":
      return [];
    case "variant":
      return field.nullable ? null : { [field.discriminator]: "" };
    case "line":
      return "";
    case "reference":
      return null;
    case "byVocabulary":
      return {};
    case "optionalData":
      return undefined;
    case "optionalFormula":
    case "optionalSource":
      return null;
    case "refList":
      return [];
    case "triState":
      return null;
    case "contentToken":
      return "";
    case "missionRule":
      return { ruleKey: "", shape: "", rollTable: null, clock: null, intel: null, points: null, source: { locators: [], conflicts: [] } };
    case "coreFormula":
      // The rounding is the author's choice (from the catalog) — a new Formula starts without one.
      return { expression: "0", rounding: "", minimum: null, maximum: null, unit: null, variables: [] };
  }
}

/** A new, empty payload for a descriptor (the generic descriptor's single field IS the payload). */
export function initialPayload(descriptor: ContractDescriptor): Record<string, unknown> {
  if (descriptor === GENERIC_DESCRIPTOR) return {};
  const whole = descriptor.fields.find((f) => f.key === "");
  if (whole !== undefined) return initialFieldValue(whole) as Record<string, unknown>;
  return Object.fromEntries(descriptor.fields.filter((f) => f.input !== "optionalData").map((f) => [f.key, initialFieldValue(f)]));
}
