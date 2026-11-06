/**
 * Card Presentation DTOs (PAS-10 M6-WO9 Phase C) — the JSON shape of the server's Card Presentation Contract v1
 * (the domain package's card contract) as the Studio API returns it. Character UI code never imports the domain package, so
 * the contract is restated here structurally. Every mechanical value is the server's; nothing here is computed.
 */
import type { DefinitionRefDto, ReleaseSummaryDto } from "./character-client";

export type CardCategoryDto = "SIGNATURE_SPELL" | "SIGNATURE_MANEUVER" | "WEAPON" | "ATTACK" | "MAGE_ART" | "GENERAL_ACTION";
export type CardValueDto<T> = { status: "AVAILABLE"; value: T } | { status: "UNAVAILABLE"; code: string; reason: string } | { status: "DEFERRED"; conflictKey: string; reason: string };
export type CardAvailabilityDto = "AVAILABLE" | "AVAILABLE_WITH_RUNTIME_DEFERRED" | "INVALID" | "INCOMPLETE" | "UNAVAILABLE";
export type RevisionRoleDto = "CURRENT" | "DRAFT" | "HISTORICAL";

export interface CardAbilityIdentityDto {
  kind: "SPELL" | "MANEUVER";
  abilityId: string | null;
  revisionNumber: number | null;
  revisionRole: RevisionRoleDto;
}
export interface RulesetProvenanceDto {
  rulesetId: string;
  manifestId: string;
  [k: string]: unknown;
}
export interface CardProvenanceDto {
  rulesetProvenance: RulesetProvenanceDto;
  characterReleaseId: string | null;
  characterId: string | null;
  ability: CardAbilityIdentityDto | null;
  sources: DefinitionRefDto[];
  evaluation: { authority: string; state: string };
}
export interface CardCostLineDto {
  label: string;
  currency: "MP" | "AP" | "PERCENT";
  value: number;
  source: DefinitionRefDto | null;
}
export interface CardTargetingDto {
  targeting: DefinitionRefDto | null;
  range: CardValueDto<{ value: number | null; unit: string | null; model: string; ruleText: string | null }>;
  targetCount: { kind: string; count: number | null };
}
export interface InstructionBlockDto {
  key: string;
  kind: "TARGETS" | "DELIVERY" | "STEP" | "GROUP" | "UNRESOLVED" | "NOTE";
  text: string;
  refs: string[];
}
export interface CardInstructionsDto {
  language: "en";
  status: "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
  blocks: InstructionBlockDto[];
  unresolved: Array<{ code: string; message: string }>;
}
export interface CardTraitEntryDto {
  componentKey: string;
  trait: DefinitionRefDto;
  scope: { scope: string; componentKey: string | null };
  modifications: Array<{ kind: string; targetComponentKey: string | null; selected: number | string | boolean | null; detail: Record<string, unknown> }>;
}
export interface CardPropertyEntryDto {
  trait: DefinitionRefDto;
  traitKey: string;
  executionStatus: string;
  parameters: Record<string, number>;
  summary: string;
}
export interface CardRequirementEntryDto {
  requirementKey: string;
  kind: string;
  required: string;
  actual: string;
  satisfied: boolean | null;
  source: DefinitionRefDto;
}
export interface CardEquippedStateDto {
  hand: "UNARMED" | "MAIN_HAND" | "OFF_HAND";
  grip: string;
  occupies: string[];
}
export interface CardImprovementEntryDto {
  improvement: DefinitionRefDto;
  improvementKey: string;
  status: "ACTIVE" | "CONDITIONAL" | "FUTURE" | "UNAVAILABLE" | "UNRESOLVED";
  eligibility: string;
  applicability: string;
  rulesText: string;
  prerequisites: Array<{ prerequisiteKey: string; kind: string; satisfied: boolean | null; progression: string; reason: string | null }>;
  modifications: Array<{ modificationKey: string; kind: string; support: string; conditional: boolean; reason: string | null }>;
  reasons: Array<{ code: string; message: string }>;
}

export interface SpellSectionDto {
  kind: "SIGNATURE_SPELL";
  authority: string | null;
  affinity: DefinitionRefDto | null;
  keywords: string[];
  duration: DefinitionRefDto | null;
  castingConditions: DefinitionRefDto[];
  traits: CardTraitEntryDto[];
  runtime: {
    sustain: CardValueDto<{ mpPerRound: number | null; apPerRound: number; meEligible: boolean }> | null;
    manaLock: CardValueDto<never> | null;
    concentration: string | null;
  };
}
export interface ManeuverSectionDto {
  kind: "SIGNATURE_MANEUVER";
  actions: Array<{ actionKey: string; order: number; source: DefinitionRefDto; weapon: DefinitionRefDto | null; attackKey: string | null }>;
  duration: DefinitionRefDto | null;
  conditions: DefinitionRefDto[];
  traits: CardTraitEntryDto[];
  performance: CardValueDto<Record<string, unknown>> | null;
}
export interface WeaponSectionDto {
  kind: "WEAPON";
  weapon: DefinitionRefDto;
  equipped: CardEquippedStateDto;
  profileKind: string;
  equipmentRole: string;
  category: string | null;
  handedness: string | null;
  scalingModel: string;
  power: CardValueDto<number>;
  martialRankKey: string | null;
  exampleForms: string[];
  properties: CardPropertyEntryDto[];
  equippedModifiers: Array<{ modifierKey: string; target: string; value: number }>;
  grantedFeatures: Array<{ featureKey: string; executionStatus: string; summary: string }>;
  requirements: CardRequirementEntryDto[];
  moveset: Array<{ attack: DefinitionRefDto; cardKey: string }>;
}
export interface AttackSectionDto {
  kind: "ATTACK";
  weapon: DefinitionRefDto;
  attack: DefinitionRefDto;
  attackKey: string;
  equipped: CardEquippedStateDto;
  moveKey: string;
  weaponFamilyKey: string;
  accuracyModifier: number;
  damage: Array<{ profileKey: string; damageType: string; status: string; reason: string | null; scaling: string; base: string; final: string | null; steps: Array<{ step: string; detail: string; source: DefinitionRefDto | null }> }>;
  range: { mode: string; reachFeet: number | null; rangeFeet: number | null; lengthFeet: number | null; area: { shape: string; radiusFeet: number } | null; basis: { stat: string; statScore: number; feetPerPoint: number } | null };
  resolution: Record<string, unknown>;
  properties: { weapon: CardPropertyEntryDto[]; move: CardPropertyEntryDto[] };
  notExecuted: string[];
  requirements: CardRequirementEntryDto[];
  eligibility: "ELIGIBLE" | "INELIGIBLE" | "UNRESOLVED";
  equipmentProvenance: { rulesetId: string; manifestId: string; releaseId: string | null };
}
export interface GeneralActionSectionDto {
  kind: "GENERAL_ACTION";
  action: DefinitionRefDto;
  actionKey: string;
  timing: string;
  requiresTrigger: boolean;
  eligibility: { status: "NO_REQUIREMENTS" };
  otherCosts: Array<{ costKey: string; policy: string; amount: number }>;
  movementGrant: { expression: string; unit: string | null; inputs: Array<{ variable: string; statistic: string | null; current: CardValueDto<number> }>; value: CardValueDto<number> } | null;
  costOverridableByExplicitRule: boolean;
  source: { locators: string[]; conflicts: string[] };
  improvements: CardImprovementEntryDto[];
}
export interface MageArtSectionDto {
  kind: "MAGE_ART";
  domain: CardValueDto<never>;
}
export type CardSectionDto = SpellSectionDto | ManeuverSectionDto | WeaponSectionDto | AttackSectionDto | GeneralActionSectionDto | MageArtSectionDto;

export interface CardDto<S extends CardSectionDto = CardSectionDto> {
  contractVersion: 1;
  cardKey: string;
  category: CardCategoryDto;
  name: string;
  description: string;
  artwork: { kind: "PLACEHOLDER" };
  availability: CardAvailabilityDto;
  provenance: CardProvenanceDto;
  costs: { ap: CardValueDto<number>; mp: CardValueDto<number>; breakdown: CardCostLineDto[] };
  targeting: CardValueDto<CardTargetingDto>;
  /** The typed semantic rules model (kept opaque here: the UI renders the server's generated instructions). */
  rules: CardValueDto<{ kind: string; [k: string]: unknown }>;
  instructions: CardInstructionsDto;
  limitations: Array<{ code: string; message: string }>;
  section: S;
  snapshot: { contractVersion: 1; cardKey: string; rulesetProvenance: RulesetProvenanceDto; characterReleaseId: string | null; ability: CardAbilityIdentityDto | null; sources: string[] };
}

export interface CardSlotDto {
  revisionNumber: number | null;
  card: CardDto | null;
  unavailable: { code: string; reason: string } | null;
}
export interface SignatureCardEntryDto {
  abilityId: string;
  abilityKind: "SPELL" | "MANEUVER";
  status: "DRAFT" | "ACTIVE" | "RETIRED";
  lockVersion: number;
  current: CardSlotDto | null;
  draft: CardSlotDto | null;
  history: CardSlotDto[];
}
export interface ActionDirectoryDto {
  status: "READY" | "UNAVAILABLE";
  reasons: Array<{ code: string; message: string }>;
  cards: CardDto<GeneralActionSectionDto>[];
  unattached: CardImprovementEntryDto[];
}
export interface CardLibraryDto {
  contractVersion: 1;
  character: { id: string; name: string; level: number; lockVersion: number };
  release: ReleaseSummaryDto;
  loadout: { version: number; status: "VALID" | "INVALID" };
  spells: SignatureCardEntryDto[];
  maneuvers: SignatureCardEntryDto[];
  weapons: CardDto<WeaponSectionDto>[];
  attacks: CardDto<AttackSectionDto>[];
  actions: ActionDirectoryDto;
  mageArts: { domain: CardValueDto<never>; cards: never[] };
  names: Record<string, string>;
}
export interface ActionDirectoryViewDto {
  contractVersion: 1;
  character: { id: string; name: string; level: number; lockVersion: number };
  release: ReleaseSummaryDto;
  directory: ActionDirectoryDto;
  names: Record<string, string>;
}
