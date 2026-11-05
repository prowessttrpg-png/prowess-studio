import type { DefinitionRefDto, ReleaseSummaryDto, SpellComponentOptionDto, SpellEvaluationDto, SpellOrderedUseDto, SpellStateDto, SpellTraitUseDto, SpellUseDto } from "./character-client";

/** JSON transport types only. Authored choices are separate from evaluated server outputs. */
export type ManeuverSourceDto = { kind: "FOUNDATION"; definition: DefinitionRefDto } | { kind: "WEAPON_ATTACK"; weapon: DefinitionRefDto; attack: DefinitionRefDto; attackKey: string; damageProfileKey: string };
export interface ManeuverActionDto { componentKey: string; order: number; source: ManeuverSourceDto }
export interface ManeuverDraftDto {
  schemaVersion: 1;
  concept: { name: string; description: string; visualDescription: string; notes: string; narrativeTags: string[] };
  actions: ManeuverActionDto[];
  affinity: DefinitionRefDto | null;
  effects: SpellOrderedUseDto[];
  effectAttachments: { effectKey: string; actionKeys: string[] }[];
  traits: SpellTraitUseDto[];
  duration: SpellUseDto | null;
  conditions: SpellOrderedUseDto[];
  powerfulBlow: { actionKeys: string[] } | null;
}
export interface ManeuverEvaluationDto {
  state: Exclude<SpellStateDto, "UNREADABLE">;
  missing: string[];
  issues: { code: string; path: string; message: string }[];
  components: DefinitionRefDto[];
  cost: {
    valid: boolean;
    ap: { baseApCost: number; protectedActionAp?: number; appliedConditionFloor?: number; conditions: { listedApReduction: number; effectiveApReduction: number; maximumApReduction: number }; postConditionApCost: number; signature: { assigned: boolean; reduction: number; applied: boolean }; finalApCost: number; contributions: { componentKey: string; contributionKey: string; value: number; definition: DefinitionRefDto }[] };
    mp: { baseMpCost: number; conditionMpReduction: number; finalMpCost: number };
  } | null;
  authored: {
    construction: NonNullable<SpellEvaluationDto["construction"]>;
    actions: { componentKey: string; [key: string]: unknown }[];
    effects: { actionKey: string | null; result: { family: string; [key: string]: unknown } }[];
    durationConditions?: { conditions: { componentKey: string; definition: DefinitionRefDto; consumesSlot: boolean; performance?: { rank: string }; preparationAp?: number }[]; conditionSummary: { usedCapacity: number; maximumCapacity: number } };
    [key: string]: unknown;
  } | null;
  inspector: { sourceMap: unknown } | null;
  runtimeDeferred: { code: string; message: string }[];
}
export interface ManeuverEntryDto {
  id: string; abilityKind: "MANEUVER"; status: "DRAFT" | "ACTIVE" | "RETIRED"; lockVersion: number; createdAt: string; retiredAt: string | null;
  current: { revisionId: string; revisionNumber: number; createdAt: string; draft: ManeuverDraftDto | null; evaluation: ManeuverEvaluationDto | null } | null;
  draft: { draft: ManeuverDraftDto | null; evaluation: ManeuverEvaluationDto | null } | null;
  state: SpellStateDto;
}
export interface ManeuverDetailDto {
  character: { id: string; name: string; level: number; lockVersion: number }; release: ReleaseSummaryDto;
  signature: { capacity: number | null; used: number }; maneuver: ManeuverEntryDto;
  history: { revisionId: string; revisionNumber: number; createdAt: string; characterReleaseId: string; current: boolean; draft: ManeuverDraftDto | null; evaluation: ManeuverEvaluationDto | null }[];
  names: Record<string, string>;
}
export interface ManeuverOptionDto extends SpellComponentOptionDto { available: boolean; unavailableReason: string | null; foundationCategories: string[]; consumesSlot: boolean | null; slotExemption: string | null; performanceVersion: string | null }
export interface ManeuverBuilderDto extends ManeuverDetailDto {
  loadoutVersion: number; stats: Record<string, number>;
  performance: { definition: DefinitionRefDto; currentRank: string | null; benefits: { rank: string; mpReduction: number; preparationAp: number }[] }[];
  catalog: {
    actions: { optionKey: string; category: "WEAPON_ATTACK" | "MOVEMENT" | "DEFENSE" | "INTERACTION"; source: ManeuverSourceDto; available: boolean; reasons: { code: string; message: string }[]; profile: Record<string, unknown> | null; keywords: string[] }[];
    effects: ManeuverOptionDto[]; traits: ManeuverOptionDto[]; durations: ManeuverOptionDto[]; conditions: ManeuverOptionDto[];
    affinities: { affinity: DefinitionRefDto; rank: string }[];
    martial: { skillKey: string | null; rankKey: string | null; maximumActionBlocks: number | null; effectCapacity: number | null; traitCapacity: number | null; conditionCapacity: number | null };
    limitations: { code: string; message: string }[];
    performanceCondition: { present: boolean; definitions: DefinitionRefDto[] };
    powerfulBlow: { available: boolean; minimumRepetitions: number; maximumGroups: number };
  };
}
export interface SheetManeuverDto { id: string; name: string; revisionNumber: number; state: SpellStateDto; actions: ManeuverActionDto[]; finalApCost: number | null; finalMpCost: number | null; effects: DefinitionRefDto[]; keywords: string[]; warnings: { code: string; message: string }[] }
