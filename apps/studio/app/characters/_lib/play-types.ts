/**
 * PAS-10 M6-WO10 — Play Workspace DTOs: the JSON shape the server's Play Workspace API returns. Studio cannot import the
 * M5 domain package (M5-I017), so these mirror the contract structurally. Every number in them is the server's; the
 * client renders, collects choices / targets / raw rolls, and submits — it never prices, compares or resolves.
 */
import type { DefinitionRefDto, ReleaseSummaryDto } from "./character-client";

export type PlayAvailabilityDto = "AVAILABLE" | "UNAVAILABLE" | "INSUFFICIENT_RESOURCES" | "PENDING_INPUT" | "UNSUPPORTED" | "REFERENCE_ONLY";
export type PlayStatusDto = "COMMITTABLE" | "REFUSED" | "PENDING_INPUT" | "PENDING_DECISION" | "UNSUPPORTED" | "RECONCILIATION_REQUIRED";
export type PlayTimingEventDto = "BEGIN_COMBAT" | "START_ROUND" | "START_TURN" | "END_TURN" | "END_ROUND" | "END_COMBAT";
export interface PlayReasonDto {
  readonly code: string;
  readonly message: string;
}
export interface SheetValueDto {
  readonly value: number | null;
  readonly unit: string | null;
  readonly unavailable: string | null;
}
export interface PlayRuntimeDto {
  readonly characterId: string;
  readonly releaseId: string;
  readonly advancementCount: number;
  readonly combat: { readonly active: boolean; readonly round: number | null; readonly surprised: boolean; readonly phase: "OUT_OF_COMBAT" | "AWAITING_ROUND" | "ROUND"; readonly turn: "NOT_TAKEN" | "ACTIVE" | "ENDED" };
  readonly movementAllowance: number;
  readonly reservedMp: number;
  readonly movement: { readonly grants: readonly number[]; readonly segments: readonly { readonly distance: number; readonly terrainKey: string; readonly allowanceCost: number }[] };
  readonly activeMagic: ActiveMagicStateDto | null;
}
export interface ActiveEffectDto {
  readonly activeEffectKey: string;
  readonly ability: { readonly canonicalKey: string; readonly signatureAbilityId?: string; readonly revisionNumber?: number; readonly kind?: string };
  readonly executionKey: string;
  readonly outcomes: readonly { readonly targetKey: string; readonly effectKey: string; readonly outcomeKey: string; readonly definition: DefinitionRefDto }[];
  readonly duration: { readonly definition: DefinitionRefDto; readonly concept: string; readonly remainingRounds: number | null; readonly dismissal: string };
  readonly sustain: { readonly finalSpellMp: number; readonly pro: number; readonly mpCost: number; readonly apCost: number; readonly meEligible: boolean; readonly lastPayment: { readonly ap: number; readonly me: number; readonly mp: number } | null } | null;
  readonly concentration: { readonly required: boolean };
  readonly manaLock: { readonly reservedMp: number; readonly rule: string } | null;
  readonly ticks: readonly { readonly timing: string; readonly targetKey: string; readonly effectKey: string }[];
  readonly activation: { readonly round: number | null };
  readonly status: string;
  readonly endReason: string | null;
  readonly endedBy: { readonly event: string; readonly sourceKey: string | null } | null;
}
export interface ActiveMagicStateDto {
  readonly effects: readonly ActiveEffectDto[];
  readonly channel: { readonly channelKey: string; readonly spell: { readonly canonicalKey: string }; readonly requiredAp: number; readonly investedAp: number; readonly investedThisRound: number; readonly mpPayment: { readonly status: string; readonly conflictKey: string }; readonly status: string } | null;
}
export interface PlayResourceDto {
  readonly resourceKey: string;
  readonly definition: DefinitionRefDto | null;
  readonly name: string;
  readonly current: number;
  readonly minimum: number | null;
  readonly maximum: number | null;
  readonly reservedCapacity: number;
  readonly stored: boolean;
  readonly refresh: readonly { readonly timing: string; readonly target: string }[];
  readonly expiry: readonly { readonly timing: string; readonly preservable: boolean }[];
  readonly runtimeOnly: boolean;
}
interface Entry {
  readonly cardKey: string;
  readonly name: string;
  readonly availability: PlayAvailabilityDto;
  readonly reasons: readonly PlayReasonDto[];
}
export interface PlayActionDto extends Entry {
  readonly category: "GENERAL" | "COUNTER";
  readonly actionKey: string;
  readonly action: DefinitionRefDto;
  readonly timing: string;
  readonly requiresTrigger: boolean;
  readonly costModel: { readonly model: string; readonly amount?: number; readonly minimum?: number; readonly maximum?: number; readonly determinedBy?: string } | null;
  readonly apCost: { readonly status: string; readonly value?: number; readonly reason?: string };
  readonly otherCosts: readonly { readonly costKey: string; readonly policy: string; readonly amount: number }[];
  readonly grantsMovement: boolean;
}
export interface PlayAttackDto extends Entry {
  readonly attackKey: string;
  readonly hand: string;
  readonly weapon: DefinitionRefDto;
  readonly attack: DefinitionRefDto;
  readonly grip: string;
  readonly apCost: number;
  readonly mpCost: number;
  readonly damage: readonly { readonly profileKey: string; readonly damageType: string; readonly status: string; readonly final: { readonly expression?: string } | null; readonly reason: string | null }[];
  readonly range: { readonly mode: string; readonly reachFeet: number | null; readonly rangeFeet: number | null };
  readonly resolution: { readonly mode: string; readonly onMiss?: string; readonly reason?: string };
  readonly eligibility: string;
  readonly notExecuted: readonly string[];
  readonly support: { readonly supported: boolean; readonly reason: string | null };
}
export interface PlaySpellDto extends Entry {
  readonly abilityId: string;
  readonly revisionNumber: number;
  readonly state: string;
  readonly costs: { readonly finalApCost: number; readonly finalMpCost: number } | null;
  readonly meEligible: boolean;
  readonly keywords: readonly string[];
  readonly targetLimit: { readonly kind: string; readonly maximum: number | null } | null;
  readonly chain: { readonly start: string | null; readonly nodes: readonly { readonly effectKey: string; readonly definition: DefinitionRefDto; readonly family: string; readonly resolution: string; readonly behavior: string; readonly route: string }[] } | null;
  readonly duration: { readonly mode: string; readonly persists: boolean; readonly sustain: boolean; readonly manaLock: boolean; readonly concentration: string } | null;
}
export interface PlayManeuverDto extends Entry {
  readonly abilityId: string;
  readonly revisionNumber: number;
  readonly state: string;
  readonly costs: { readonly finalApCost: number; readonly finalMpCost: number } | null;
  readonly groups: readonly { readonly groupKey: string; readonly kind: string; readonly actionKeys: readonly string[]; readonly attack: DefinitionRefDto | null; readonly resolution: { readonly mode: string; readonly replacedBy?: string }; readonly targetLimit: number | null; readonly effects: readonly { readonly effectKey: string; readonly definition: DefinitionRefDto; readonly family: string; readonly route: string }[] }[];
  readonly targetLimit: { readonly kind: string; readonly maximum: number | null } | null;
  readonly martialRank: string | null;
  readonly separatelyPriced: readonly { readonly condition: DefinitionRefDto; readonly preparationAp: number }[];
}
export interface PlayWorkspaceDto {
  readonly contractVersion: 1;
  readonly character: { readonly id: string; readonly name: string; readonly level: number; readonly releaseId: string };
  readonly header: { readonly characterDie: { readonly dieKey: string; readonly faces: number }; readonly characterDc: SheetValueDto; readonly accuracy: SheetValueDto; readonly dodge: SheetValueDto; readonly armor: SheetValueDto; readonly initiative: SheetValueDto; readonly movement: SheetValueDto; readonly range: SheetValueDto };
  readonly runtime: PlayRuntimeDto;
  readonly persisted: boolean;
  readonly reconciliation: { readonly required: boolean; readonly reasons: readonly PlayReasonDto[] };
  readonly timing: { readonly legal: readonly PlayTimingEventDto[]; readonly window: "OWN_TURN" | "OUTSIDE_OWN_TURN" };
  readonly resources: readonly PlayResourceDto[];
  readonly concentration: { readonly capacity: number; readonly used: number; readonly dc: number | null } | { readonly unavailable: string };
  readonly actions: readonly PlayActionDto[];
  readonly attacks: readonly PlayAttackDto[];
  readonly spells: readonly PlaySpellDto[];
  readonly maneuvers: readonly PlayManeuverDto[];
  readonly activeMagic: { readonly state: ActiveMagicStateDto | null; readonly pendingDecision: "MAINTENANCE_SELECTION" | "CONCENTRATION_SAVE" | null };
  readonly terrains: readonly { readonly terrainKey: string; readonly definition: DefinitionRefDto; readonly name: string }[];
  readonly names: Readonly<Record<string, string>>;
}
export interface PlayEventDto {
  readonly id: string;
  readonly sequence: number;
  readonly operationKind: string;
  readonly classification: "RULES_EXECUTED" | "MANUAL_ADJUSTMENT" | "REFERENCE_ONLY" | "NOTE";
  readonly summary: string;
  readonly rulesetReleaseId: string;
  readonly runtimeVersion: number;
  readonly playStateVersion: number;
  readonly createdAt: string;
  readonly record: PlayOutcomeDto;
}
export interface PlayVersionsDto {
  readonly runtimeVersion: number;
  readonly playStateVersion: number;
}
export interface PlayViewDto {
  readonly character: { readonly id: string; readonly name: string; readonly level: number; readonly lockVersion: number };
  readonly release: ReleaseSummaryDto;
  readonly versions: PlayVersionsDto;
  readonly workspace: PlayWorkspaceDto;
  readonly recentEvents: readonly PlayEventDto[];
}
export interface PlayPendingDto {
  readonly requestKey?: string;
  readonly kind: string;
  readonly targetKey?: string;
  readonly scope?: string;
  readonly by?: "ATTACKER" | "DEFENDER";
  readonly options?: readonly string[] | null;
  readonly defaultDifficultyClass?: number | null;
  readonly characterDie?: string | null;
  readonly model?: string;
  readonly minimum?: number;
  readonly maximum?: number | null;
  readonly concentrationDc?: number | null;
}
export interface PlayOutcomeDto {
  readonly status: PlayStatusDto;
  readonly classification?: string | null;
  readonly operation: Record<string, unknown>;
  readonly summary: string;
  readonly reasons: readonly PlayReasonDto[];
  readonly resourcesBefore: readonly { readonly resourceKey: string; readonly current: number; readonly reservedCapacity: number }[];
  readonly resourcesAfter: readonly { readonly resourceKey: string; readonly current: number; readonly reservedCapacity: number }[] | null;
  readonly source: Record<string, unknown> | null;
  readonly trace: Record<string, unknown>;
  readonly pending: readonly PlayPendingDto[];
  readonly inputs: Record<string, unknown>;
}
export interface PlayPreviewDto {
  readonly versions: PlayVersionsDto;
  readonly outcome: PlayOutcomeDto;
}
export interface PlayCommitDto {
  readonly committed: boolean;
  readonly replayed: boolean;
  readonly outcome: PlayOutcomeDto | null;
  readonly event: PlayEventDto | null;
  readonly workspace: PlayViewDto;
}
