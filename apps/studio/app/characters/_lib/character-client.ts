/**
 * Character API client (PAS-10 M6-WO3) — the ONLY way Character UI code talks to data. Every call goes through the
 * shared Studio transport to the Studio HTTP API; nothing under `app/characters/` imports the database package, Prisma, a
 * repository or the M5 domain package (scripts/check-architecture.mjs, m6-wo3-static). Deliberately thin: it never validates a build or computes a statistic — the server's
 * Character service and the Release's own rules do.
 */
import { fetchJsonBody, query } from "../../../src/api-client/http";

export class CharacterApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "CharacterApiError";
    this.code = code;
    this.status = status;
  }
}

type Method = "GET" | "POST" | "PUT" | "DELETE";
async function request<T>(method: Method, path: string, body?: unknown, form?: FormData): Promise<{ data: T; pagination?: { page: number; pageSize: number; total: number; totalPages: number } }> {
  const init: RequestInit | undefined = method === "GET" ? undefined : form !== undefined ? { method, body: form } : method === "DELETE" ? { method } : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) };
  const sent = await fetchJsonBody(path, init);
  if (sent.kind === "NETWORK_FAILURE") throw new CharacterApiError("NETWORK_ERROR", "Could not reach the server.", 0);
  if (sent.kind === "UNREADABLE_BODY") throw new CharacterApiError("INVALID_RESPONSE", "The server returned an unreadable response.", sent.response.status);
  const json = sent.body as Record<string, unknown> | null;
  if (!sent.response.ok) {
    throw new CharacterApiError(json !== null && typeof json.code === "string" ? json.code : "UNKNOWN_ERROR", json !== null && typeof json.message === "string" ? json.message : "The request failed.", sent.response.status);
  }
  return json as { data: T; pagination?: { page: number; pageSize: number; total: number; totalPages: number } };
}
const enc = encodeURIComponent;

// --- DTOs -----------------------------------------------------------------------------------------------------------

export interface DefinitionRefDto {
  entityId: string;
  entityVersionId: string;
  canonicalKey: string;
  definitionKind: string;
  systemFamily: string;
}
export interface SelectionDto {
  entityId: string;
  entityVersionId: string;
}
export interface CandidateDto {
  ancestry: SelectionDto | null;
  ancestryStatChoices: Array<{ grantKey: string; stat: string }>;
  statAllocations: Record<string, number>;
  skills: Array<{ skill: SelectionDto; sourceKind: string; sourceGrantKey: string | null }>;
  primaryAffinity: SelectionDto | null;
}
export interface IssueDto {
  code: string;
  severity: "ERROR" | "INCOMPLETE";
  path: string;
  message: string;
  source: { canonicalKey: string; entityVersionId: string } | null;
}
export interface ResolutionDto {
  status: "READY" | "INCOMPLETE" | "INVALID";
  issues: IssueDto[];
  capability: { status: "READY" | "MISSING_REQUIRED_CONTENT"; missing: Array<{ requirement: string; message: string }> };
  resolved: {
    level: number | null;
    characterDie: { dieKey: string; faces: number } | null;
    creationRule: DefinitionRefDto | null;
    ancestry: DefinitionRefDto | null;
    baseHp: number | null;
    baseMp: number | null;
    pointBudget: number | null;
    pointsSpent: number;
    pointsRemaining: number | null;
    stats: Array<{ stat: string; baseline: number; ancestry: number; allocated: number; final: number; minimum: number; maximum: number; definition: DefinitionRefDto }>;
    skills: Array<{ skill: DefinitionRefDto; rankKey: string; sourceKind: string; sourceGrantKey: string | null }>;
    freeSkillCount: number | null;
    primaryAffinity: DefinitionRefDto | null;
  };
  derivedPreview: Array<{ statistic: string; value: number; unit: string | null; definition: DefinitionRefDto }> | null;
}
export interface ReleaseSummaryDto {
  id: string;
  rulesetId: string;
  rulesetName: string;
  releaseNumber: number;
  versionLabel: string;
  channel: string;
}
export interface CharacterDto {
  id: string;
  name: string;
  concept: string | null;
  level: number;
  lockVersion: number;
  coreCreationCompletedAt: string | null;
  status: "DRAFT" | "CORE_COMPLETE";
  createdAt: string;
  updatedAt: string;
  release: ReleaseSummaryDto;
  choices: CandidateDto & { skills: Array<{ skill: SelectionDto; rankKey: string; sourceKind: string; sourceGrantKey: string | null }> };
  resolution: ResolutionDto;
  names: Record<string, string>;
  /** PAS-10 M6-WO4: the present mechanical profile (null for a Draft) and the committed advancement history. */
  profile?: ProfileDto | null;
  profileIssues?: AdvancementIssueDto[];
  advancementHistory?: HistoryEntryDto[];
  advancementCapability?: { status: string; missing: Array<{ requirement: string; message: string }> };
}
export interface CharacterListItemDto {
  id: string;
  name: string;
  level: number;
  status: "DRAFT" | "CORE_COMPLETE";
  updatedAt: string;
  release: ReleaseSummaryDto;
}
export interface OptionDto {
  ref: DefinitionRefDto;
  displayName: string;
  shortDescription: string | null;
  revisionNumber: number;
  payload: Record<string, unknown> | null;
  schemaVersion?: number;
  executable?: boolean;
}
export interface CreationContextDto {
  character: { id: string; name: string; lockVersion: number; status: "DRAFT" | "CORE_COMPLETE" };
  release: ReleaseSummaryDto;
  capability: ResolutionDto["capability"];
  creationRule: OptionDto | null;
  stats: Array<{ stat: string; minimum: number; maximum: number; ref: DefinitionRefDto }>;
  characterDie: { level: number; dieKey: string; faces: number } | null;
  skillRankLadder: { ref: DefinitionRefDto; ranks: Array<{ rankKey: string; order: number }> } | null;
  derivedStatistics: Array<{ statistic: string; ref: DefinitionRefDto; required: boolean }>;
  ancestries: OptionDto[];
  skills: OptionDto[];
  affinities: OptionDto[];
}
export interface CapabilityDto {
  status: "READY" | "MISSING_REQUIRED_CONTENT";
  missing: Array<{ requirement: string; message: string }>;
  release: ReleaseSummaryDto;
}

// --- calls ----------------------------------------------------------------------------------------------------------

export async function listCharacters(page = 1, pageSize = 50) {
  const r = await request<CharacterListItemDto[]>("GET", `/api/characters${query({ page, pageSize })}`);
  return { items: r.data, total: r.pagination?.total ?? r.data.length };
}
export const createCharacter = async (body: { name: string; concept: string | null; rulesetReleaseId: string }) => (await request<CharacterDto>("POST", "/api/characters", body)).data;
export const getCharacter = async (id: string) => (await request<CharacterDto>("GET", `/api/characters/${enc(id)}`)).data;
export const getCreationContext = async (id: string) => (await request<CreationContextDto>("GET", `/api/characters/${enc(id)}/creation-context`)).data;
export const checkCharacter = async (id: string, candidate: CandidateDto) => (await request<ResolutionDto>("POST", `/api/characters/${enc(id)}/validate`, { candidate })).data;
export const saveCreation = async (id: string, expectedLockVersion: number, candidate: CandidateDto) => (await request<CharacterDto>("PUT", `/api/characters/${enc(id)}/creation`, { expectedLockVersion, candidate })).data;
export const saveProfile = async (id: string, expectedLockVersion: number, name: string, concept: string | null) => (await request<CharacterDto>("PUT", `/api/characters/${enc(id)}/profile`, { expectedLockVersion, name, concept })).data;
export const completeCoreCreation = async (id: string, expectedLockVersion: number) => (await request<CharacterDto>("POST", `/api/characters/${enc(id)}/finalize`, { expectedLockVersion })).data;
export const getCapability = async (releaseId: string) => (await request<CapabilityDto>("GET", `/api/character-creation/releases/${enc(releaseId)}/capability`)).data;

/** The stored choices as an editable candidate (ranks are never sent back — the server decides them). */
export function candidateFrom(choices: CharacterDto["choices"]): CandidateDto {
  return {
    ancestry: choices.ancestry,
    ancestryStatChoices: choices.ancestryStatChoices.map((c) => ({ grantKey: c.grantKey, stat: c.stat })),
    statAllocations: { ...choices.statAllocations },
    skills: choices.skills.map((s) => ({ skill: s.skill, sourceKind: s.sourceKind, sourceGrantKey: s.sourceGrantKey })),
    primaryAffinity: choices.primaryAffinity,
  };
}

// --- PAS-10 M6-WO4: advancement, the mechanical profile, access & eligibility --------------------------------------

export interface ProfileDto {
  level: number;
  maximumLevel: number;
  characterDie: { dieKey: string; faces: number };
  baseHp: number;
  baseMp: number;
  stats: Array<{ stat: string; baseline: number; ancestry: number; creation: number; advancement: number; final: number; minimum: number; maximum: number; mastery: boolean | null; definition: DefinitionRefDto }>;
  skills: Array<{ skill: DefinitionRefDto; rankKey: string; source: { kind: string; grantKey: string | null; level: number }; history: Array<{ level: number; action: string; fromRankKey: string; toRankKey: string }> }>;
  affinities: Array<{ affinity: DefinitionRefDto; identity: string; role: string; rank: string; acquisition: { level: number; optionKey: string }; history: Array<{ level: number; optionKey: string; from: string; to: string }> }>;
  derivedStatistics: Array<{ statistic: string; value: number; unit: string | null; definition: DefinitionRefDto }>;
  signatureCapacity: number | null;
}
export interface AdvancementIssueDto {
  code: string;
  severity: "ERROR" | "INCOMPLETE";
  path: string;
  message: string;
  source: { canonicalKey: string; entityVersionId: string } | null;
}
export interface HistoryEntryDto {
  fromLevel: number;
  toLevel: number;
  createdAt: string;
  statAllocations: Record<string, number>;
  skillAdvancements: Array<{ action: string; skill: SelectionDto }>;
  affinityChoice: { optionKey: string; affinity: SelectionDto | null } | null;
}
export interface AffinityOptionDto {
  optionKey: string;
  action: "CHOOSE_PRIMARY_AFFINITY" | "RANK_UP" | "GAIN_AFFINITY";
  target?: string;
  from?: string;
  to?: string;
  role?: string;
  startingRank?: string | null;
  conflictKey?: string | null;
}
export interface EntitlementsDto {
  fromLevel: number;
  toLevel: number;
  statPoints: number;
  skillAdvancements: number;
  characterDie: { before: { dieKey: string; faces: number }; after: { dieKey: string; faces: number } };
  affinity: { mode: string; automatic: boolean; options: AffinityOptionDto[]; source: DefinitionRefDto } | null;
  source: DefinitionRefDto;
}
export interface AccessChangesDto {
  tracks: Array<{ track: string; before: string; after: string; eligibleBefore: boolean | null; eligibleAfter: boolean | null }>;
  signatureCapacity: { before: number | null; after: number | null };
  newlyEligible: DefinitionRefDto[];
  newlyIneligible: DefinitionRefDto[];
}
export interface AdvancementChoicesDto {
  statAllocations: Record<string, number>;
  skillAdvancements: Array<{ action: "TRAIN_NEW" | "UPGRADE"; skill: SelectionDto }>;
  affinityChoice: { optionKey: string; affinity: SelectionDto | null } | null;
}
export interface AdvancementPreviewDto {
  status: "READY" | "INCOMPLETE" | "INVALID" | "MAX_LEVEL";
  issues: AdvancementIssueDto[];
  fromLevel: number | null;
  toLevel: number | null;
  entitlements: EntitlementsDto | null;
  before: ProfileDto | null;
  after: ProfileDto | null;
  accessChanges: AccessChangesDto | null;
  statPoints: { granted: number; spent: number; remaining: number } | null;
}
export interface AdvancementOptionDto {
  ref: DefinitionRefDto;
  displayName: string;
  rankKey: string | null;
}
export interface AdvancementContextDto {
  character: { id: string; name: string; level: number; lockVersion: number };
  release: ReleaseSummaryDto;
  capability: { creation: { status: string; missing: Array<{ requirement: string; message: string }> }; advancement: { status: string; missing: Array<{ requirement: string; message: string }> } };
  profile: ProfileDto;
  next: EntitlementsDto | null;
  maximumLevelReached: boolean;
  skillOptions: { trainNew: AdvancementOptionDto[]; upgrade: AdvancementOptionDto[] };
  affinityOptions: { gain: AdvancementOptionDto[]; owned: AdvancementOptionDto[] };
  history: HistoryEntryDto[];
  names: Record<string, string>;
}
export interface AccessTrackDto {
  skillKey: string;
  skill: DefinitionRefDto | null;
  rankKey: string;
  minimumRankKey: string;
  eligible: boolean | null;
}
export interface AccessDto {
  character: { id: string; level: number };
  release: ReleaseSummaryDto;
  summary: {
    status: "RESOLVED" | "UNRESOLVED";
    unresolved: string[];
    spell: { arcaneAuthority: AccessTrackDto | null; affinityAuthorities: Array<{ affinity: DefinitionRefDto; identity: string; role: string; rank: string; minimumRank: string; eligible: boolean | null }> };
    maneuver: { martial: AccessTrackDto | null };
    signatureCapacity: number | null;
    constructionRule: DefinitionRefDto | null;
  };
}
/** The WO4 fields every Character read carries (the present profile and the committed history). */
export interface CharacterProgressDto {
  profile: ProfileDto | null;
  profileIssues: AdvancementIssueDto[];
  advancementHistory: HistoryEntryDto[];
  advancementCapability: { status: string; missing: Array<{ requirement: string; message: string }> };
}

export const getAdvancementContext = async (id: string) => (await request<AdvancementContextDto>("GET", `/api/characters/${enc(id)}/advancement`)).data;
export const previewAdvancement = async (id: string, choices: AdvancementChoicesDto) => (await request<AdvancementPreviewDto>("POST", `/api/characters/${enc(id)}/advancement/preview`, { choices })).data;
export const advanceCharacter = async (id: string, expectedLockVersion: number, choices: AdvancementChoicesDto) => (await request<CharacterDto>("POST", `/api/characters/${enc(id)}/advance`, { expectedLockVersion, choices })).data;
export const getAccess = async (id: string) => (await request<AccessDto>("GET", `/api/characters/${enc(id)}/access`)).data;

// --- PAS-10 M6-WO5: the Digital Character Sheet ------------------------------------------------------------------------

export interface SheetValueDto {
  value: number | null;
  unit: string | null;
  unavailable: string | null;
  source: DefinitionRefDto | null;
}
export interface SheetResourceDto {
  resourceKey: string;
  definition: DefinitionRefDto;
  minimum: number;
  maximum: number | null;
  maximumSource: string | null;
  refresh: Array<{ timing: string; target: string }>;
  current: number | null;
  stored: boolean;
}
export interface SheetSkillDto {
  skill: DefinitionRefDto;
  rankKey: string;
  score: number | null;
  attemptAllowed: boolean | null;
  ranks: Array<{ rankKey: string; held: boolean }>;
}
export interface SheetAffinityDto {
  affinity: DefinitionRefDto;
  identity: string;
  role: string;
  rank: string;
  authority: { minimumRank: string; eligible: boolean | null } | null;
  strengths: Array<{ strengthKey: string; matchAny: string[] }>;
  weaknesses: Array<{ weaknessKey: string; matchAny: string[]; activationPenaltyPercent: number; severity: string | null }>;
}
export interface PossessionDto {
  category: string;
  item: string;
  weight: string;
}
export interface CharacterSheetDto {
  identity: { id: string; name: string; concept: string | null; level: number; maximumLevel: number; status: string; ancestry: DefinitionRefDto | null; primaryAffinity: DefinitionRefDto | null; companyPac: string | null };
  release: ReleaseSummaryDto;
  portrait: { hasImage: boolean; mimeType: string | null; width: number | null; height: number | null; zoom: number; offsetX: number; offsetY: number; version: number; imageUrl: string | null; maxBytes: number };
  mechanics: {
    stats: Array<{ stat: string; total: number; savingThrow: SheetValueDto; definition: DefinitionRefDto }>;
    combat: {
      characterDie: { dieKey: string; faces: number };
      characterDc: SheetValueDto;
      accuracy: SheetValueDto;
      armor: SheetValueDto;
      dodge: SheetValueDto;
      initiative: SheetValueDto;
      movement: SheetValueDto;
      range: SheetValueDto;
      concentration: { maximum: SheetValueDto };
    };
    skills: SheetSkillDto[];
    affinities: SheetAffinityDto[];
    attunement: { maximum: SheetValueDto; used: SheetValueDto };
    carry: { currentWeight: SheetValueDto; maximumLoad: SheetValueDto };
    signatureCapacity: number | null;
    issues: Array<{ code: string; path: string; message: string }>;
  };
  resources: SheetResourceDto[];
  playStateVersion: number;
  notes: { actionNotes: string; characterNotes: string; possessions: PossessionDto[]; version: number; limits: { companyPac: number; actionNotes: number; characterNotes: number; possessions: number; category: number; item: number; weight: number } };
  grantedEffects: Array<{ source: DefinitionRefDto | null; effect: string; duration: string | null; notes: string | null }>;
  equipment: { available: boolean; mainHand: EquippedSummaryDto | null; offHand: EquippedSummaryDto | null; loadoutVersion: number; loadoutStatus: string; loadoutIssues: LoadoutIssueDto[]; armor: null; accessorySlots: number | null; accessories: unknown[] };
  /** M6-WO6: Unarmed, Main-hand and Off-hand Weapon Attacks — server previews, never rolls. */
  weaponAttacks: CharacterAttackDto[];
  dualWield: { available: boolean; reasons: string[] };
  /** M6-WO7: the current revision of each active Signature Spell — the server's M5 evaluation, never cast. */
  signatureSpells: SheetSignatureSpellDto[];
  advancementHistoryCount: number;
  names: Record<string, string>;
}
export interface SheetSignatureSpellDto {
  id: string;
  name: string;
  revisionNumber: number;
  state: "INCOMPLETE" | "INVALID" | "VALID" | "VALID_WITH_RUNTIME_DEFERRED";
  finalApCost: number | null;
  finalMpCost: number | null;
  targeting: DefinitionRefDto | null;
  range: { model: string; value: number | null; unit: string | null; ruleText: string | null } | null;
  effectFamilies: string[];
  keywords: string[];
  duration: DefinitionRefDto | null;
  deferred: Array<{ conflictKey: string; message: string }>;
}
export interface SheetNotesInputDto {
  companyPac: string | null;
  actionNotes: string;
  characterNotes: string;
  possessions: PossessionDto[];
}

export const getSheet = async (id: string) => (await request<CharacterSheetDto>("GET", `/api/characters/${enc(id)}/sheet`)).data;
/** Sends CURRENT resource values only — maximums and every derived value stay the server's. */
export const updatePlayState = async (id: string, expectedVersion: number, resources: Record<string, number>) => (await request<CharacterSheetDto>("PUT", `/api/characters/${enc(id)}/play-state`, { expectedVersion, resources })).data;
export const updateSheetNotes = async (id: string, expectedVersion: number, notes: SheetNotesInputDto) => (await request<CharacterSheetDto>("PUT", `/api/characters/${enc(id)}/notes`, { expectedVersion, ...notes })).data;
export const uploadPortrait = async (id: string, expectedVersion: number, file: Blob) => {
  const form = new FormData();
  form.set("file", file);
  form.set("expectedVersion", String(expectedVersion));
  return (await request<CharacterSheetDto>("POST", `/api/characters/${enc(id)}/portrait`, undefined, form)).data;
};
export const updatePortraitTransform = async (id: string, expectedVersion: number, framing: { zoom: number; offsetX: number; offsetY: number }) => (await request<CharacterSheetDto>("PUT", `/api/characters/${enc(id)}/portrait-transform`, { expectedVersion, ...framing })).data;
export const removePortrait = async (id: string, expectedVersion: number) => (await request<CharacterSheetDto>("DELETE", `/api/characters/${enc(id)}/portrait${query({ expectedVersion })}`)).data;

// ---- PAS-10 M6-WO6 Weapon & Attack Library ---------------------------------------------------------------------------

export interface TraitUseDto {
  trait: DefinitionRefDto;
  traitKey: string;
  executionStatus: string;
  parameters: Record<string, number>;
  summary: string;
}
export interface EquippedSummaryDto {
  weapon: DefinitionRefDto;
  grip: "ONE_HANDED" | "TWO_HANDED";
  occupies: string[];
  familyKey: string;
  category: string | null;
  handedness: string | null;
  scalingModel: string;
  power: number | null;
  equipmentRole: string;
  properties: Array<{ traitKey: string; parameters: Record<string, number>; executionStatus: string }>;
}
export interface LoadoutIssueDto {
  code: string;
  hand: string | null;
  message: string;
}
export interface DamagePreviewDto {
  profileKey: string;
  damageType: string;
  status: "PREVIEWED" | "FAIL_CLOSED";
  reason: string | null;
  scaling: string;
  base: { count: number; sides: number; expression: string };
  gripAdjusted: { expression: string } | null;
  power: { authored: number; adjustment: number; adjusted: number; minimum: number; scalingStat: string; statScore: number } | null;
  multiplier: number | null;
  final: { count: number; sides: number; expression: string } | null;
  steps: Array<{ step: string; detail: string }>;
}
export interface CharacterAttackDto {
  attackKey: string;
  hand: "UNARMED" | "MAIN_HAND" | "OFF_HAND";
  weapon: DefinitionRefDto;
  attack: DefinitionRefDto;
  moveKey: string;
  grip: string;
  apCost: number;
  mpCost: number;
  damage: DamagePreviewDto[];
  range: { mode: string; reachFeet: number | null; rangeFeet: number | null; lengthFeet: number | null; area: { shape: string; radiusFeet: number } | null; basis: { stat: string; statScore: number; feetPerPoint: number } | null };
  resolution: { mode: string; onMiss?: string; savingThrowStat?: string; onFailure?: string; onSuccess?: string; reason?: string };
  accuracyModifier: number;
  weaponProperties: TraitUseDto[];
  moveProperties: TraitUseDto[];
  notExecuted: string[];
  eligibility: string;
}
export interface WeaponOptionDto {
  weapon: DefinitionRefDto;
  familyKey: string;
  profileKind: string;
  equipmentRole: string;
  category: string | null;
  handedness: string | null;
  scalingModel: string;
  power: number | null;
  equippable: boolean;
  reasons: string[];
}
export interface CharacterWeaponsDto {
  capability: { weaponLibrary: { status: string; missing: Array<{ requirement: string; message: string }> }; attackLibrary: { status: string; missing: Array<{ requirement: string; message: string }> } };
  loadout: { version: number; status: string; issues: LoadoutIssueDto[]; mainHand: EquippedSummaryDto | null; offHand: EquippedSummaryDto | null };
  options: WeaponOptionDto[];
  names: Record<string, string>;
}
export interface WeaponLoadoutInputDto {
  mainHand: { entityId: string; entityVersionId: string } | null;
  mainHandGrip: "ONE_HANDED" | "TWO_HANDED" | null;
  offHand: { entityId: string; entityVersionId: string } | null;
}

export const getWeapons = async (id: string) => (await request<CharacterWeaponsDto>("GET", `/api/characters/${enc(id)}/weapons`)).data;
/** Sends the loadout CHOICE only — exact Weapon pairs and the Versatile grip. Power, damage and bonuses stay the server's. */
export const updateWeaponLoadout = async (id: string, expectedVersion: number, loadout: WeaponLoadoutInputDto) => (await request<CharacterWeaponsDto>("PUT", `/api/characters/${enc(id)}/weapon-loadout`, { expectedVersion, ...loadout })).data;
export interface CharacterAttacksDto {
  loadoutVersion: number;
  library: {
    capability: CharacterWeaponsDto["capability"];
    martialRank: string | null;
    unarmed: { weapon: DefinitionRefDto; attacks: CharacterAttackDto[]; grantedFeatures: Array<{ featureKey: string; executionStatus: string; summary: string }> } | null;
    mainHand: { weapon: DefinitionRefDto; grip: string; attacks: CharacterAttackDto[] } | null;
    offHand: { weapon: DefinitionRefDto; grip: string; attacks: CharacterAttackDto[] } | null;
    dualWield: { available: boolean; reasons: string[]; sequences: Array<{ sequenceIndex: number; apCost: number; attacks: [CharacterAttackDto, CharacterAttackDto]; powerfulBlow: false }> };
    issues: LoadoutIssueDto[];
  };
  names: Record<string, string>;
}
export const getAttacks = async (id: string) => (await request<CharacterAttacksDto>("GET", `/api/characters/${enc(id)}/attacks`)).data;

// ---- PAS-10 M6-WO7 Signature Spell Builder ---------------------------------------------------------------------------
// The client submits SELECTIONS and prose only (§121). Every cost, capacity, Signature availability, Sustain or runtime
// value below is the server's M5 evaluation, displayed as given.

export type SpellStateDto = "INCOMPLETE" | "INVALID" | "VALID" | "VALID_WITH_RUNTIME_DEFERRED" | "UNREADABLE";
export type SpellStepDto = "CONCEPT" | "AUTHORITY" | "TARGETING" | "EFFECTS" | "EFFECT_CHAIN" | "TRAITS" | "DURATION" | "CASTING_CONDITIONS" | "REVIEW";
export type SpellParametersDto = Record<string, number | string | boolean>;
export interface SpellUseDto {
  definition: DefinitionRefDto;
  parameters: SpellParametersDto;
}
export interface SpellOrderedUseDto extends SpellUseDto {
  componentKey: string;
  order: number;
}
export interface SpellTraitUseDto extends SpellOrderedUseDto {
  appliesTo: { scope: string; componentKey: string | null };
}
/** The Character-owned draft payload (schema version 1) — selections and inert prose only. */
export interface SignatureSpellDraftDto {
  schemaVersion: 1;
  concept: { name: string; description: string; visualDescription: string; notes: string; narrativeTags: string[] };
  authority: "ARCANE_AUTHORITY" | "AFFINITY_AUTHORITY" | null;
  affinity: DefinitionRefDto | null;
  targeting: SpellUseDto | null;
  effects: SpellOrderedUseDto[];
  effectChain: { failurePolicy?: string; nodes?: Array<Record<string, unknown>> } | null;
  traits: SpellTraitUseDto[];
  duration: SpellUseDto | null;
  castingConditions: SpellOrderedUseDto[];
  constructionOptions: { effectSlotsTradedForTraits: number };
  additionalAffinityTraits: string[];
}
export interface SpellIssueDto {
  code: string;
  path: string;
  step: SpellStepDto;
  componentKey: string | null;
  message: string;
}
export interface SpellChainNodeDto {
  effectKey: string;
  order: number;
  family: string;
  resolution: string | null;
  behavior: string;
  behaviorSource: string;
  route: string;
  successor: string | null;
  branch: Record<string, string | null> | null;
  branchDestination: boolean;
  definition: DefinitionRefDto;
  outcomes: Array<{ outcomeKey: string; operations: Array<{ kind: string }> }>;
}
export interface SpellEvaluationDto {
  state: Exclude<SpellStateDto, "UNREADABLE">;
  missing: SpellStepDto[];
  issues: SpellIssueDto[];
  keywords: string[];
  components: DefinitionRefDto[];
  construction: {
    valid: boolean;
    access: { path: string; rank: string | null; minimumRank: string | null; satisfied: boolean; rankSource: Record<string, unknown> | null } & Record<string, unknown>;
    capacity: {
      effects: { base: number | null; remaining: number | null };
      traits: { base: number | null; effective: number | null };
      conditions: { capacity: number | null; source: Record<string, unknown> | null };
      trades: { exchangeAvailable: boolean; maximum: number; requested: number };
    } & Record<string, unknown>;
    usage: { effects: number; traits: number; conditions: number };
    signature: { capacity: number | null; usedBefore: number; candidateUse: number; projected: number; availableAfter: number | null; slotUse: string; exemption: unknown; satisfied: boolean };
    affinityAccess: Array<{ componentKey: string; satisfied: boolean }>;
    prerequisites: Array<{ componentKey: string; ruleKey: string; satisfied: boolean }>;
    traitCapacity: { ordinary: { base: number | null; effective: number | null; used: number }; affinityAdditional: { capacity: number | null; conflictKey: string | null; used: number } };
  } | null;
  targeting: {
    range: { model: string; value: number | null; unit: string | null; baseRange: number | null; ruleText: string | null } | null;
    geometry: Array<Record<string, unknown>>;
    targetCount: { kind: string; count: number | null; minimum: number | null; status: string; satisfied: boolean } | null;
    compatibility: Array<{ componentKey: string; status: string; allow: string[]; definition: DefinitionRefDto | null }>;
    deferred: Array<Record<string, unknown>>;
  } | null;
  effects: Array<{ componentKey: string; valid: boolean; family: string; resolution: string | null; targetingStatus: string; parameters: Array<{ parameter: string; value: unknown; explicit: boolean }>; problems: string[] }>;
  cost: {
    contributions: Array<{ source: string; componentKey: string; contributionKey: string; operation: string; rule: string; value: number; definition: DefinitionRefDto }>;
    baseMp: number;
    percentages: Array<{ source: string; operation: string; percent: number; applied: boolean }>;
    castingConditions: { listedPercent: number; effectivePercent: number; maximumPercent: number };
    netPercent: number;
    unroundedMp: number;
    finalMpCost: number;
    pro: number;
    baseAp: number;
    apModifiers: Array<{ source?: string; value?: number } & Record<string, unknown>>;
    finalApCost: number;
  } | null;
  costUnresolved: Array<{ path: string; message: string }>;
  chain: { start: string | null; nodes: SpellChainNodeDto[] } | null;
  runtime: {
    sustain: { mpPerRound: number | null; apPerRound: number; meEligible: boolean } | null;
    manaLock: { reservedMp: null; conflictKey: string } | null;
    concentration: string | null;
    deferred: Array<{ conflictKey: string; message: string }>;
  };
}
export interface SignatureSpellEntryDto {
  id: string;
  abilityKind: "SPELL";
  status: "DRAFT" | "ACTIVE" | "RETIRED";
  lockVersion: number;
  createdAt: string;
  retiredAt: string | null;
  current: { revisionId: string; revisionNumber: number; createdAt: string; draft: SignatureSpellDraftDto | null; evaluation: SpellEvaluationDto | null } | null;
  draft: { draft: SignatureSpellDraftDto | null; evaluation: SpellEvaluationDto | null } | null;
  state: SpellStateDto;
}
export interface CharacterAbilitiesDto {
  character: { id: string; name: string; level: number; lockVersion: number };
  release: ReleaseSummaryDto;
  signature: { capacity: number | null; used: number };
  spells: SignatureSpellEntryDto[];
  names: Record<string, string>;
}
export interface SpellRevisionDto {
  revisionId: string;
  revisionNumber: number;
  createdAt: string;
  characterReleaseId: string;
  current: boolean;
  draft: SignatureSpellDraftDto | null;
  evaluation: SpellEvaluationDto | null;
}
export interface SignatureSpellDetailDto extends Omit<CharacterAbilitiesDto, "spells"> {
  spell: SignatureSpellEntryDto;
  history: SpellRevisionDto[];
}
export interface SpellParameterDto {
  parameter: string;
  kind: string;
  minimum: number | null;
  maximum: { kind: string; value: number | null; stat: string | null } | null;
  increment: number | null;
  default: number | string | boolean | null;
  allowed: string[] | null;
}
export interface SpellComponentOptionDto {
  ref: DefinitionRefDto;
  kind: string;
  category: string | null;
  subcategory: string | null;
  keywords: string[];
  parameters: SpellParameterDto[];
  contributions: Array<{ contributionKey: string; currency: string; kind: string; amount: number | null; amounts: Record<string, number> | null; parameter: string | null; modifier: string | null }>;
  compatibility: Array<{ relation: string; allow: string[] }>;
  availability: string | null;
  durationsAllowed: string[];
  traitScope: string | null;
  effectFamilies: string[];
  futureRuntime: { sustain: boolean; manaLock: boolean; concentration: string } | null;
  description: string | null;
  eligibility: { status: "ELIGIBLE" | "INELIGIBLE" | "UNRESOLVED"; requirements: Array<{ kind: string; prerequisiteKey: string; satisfied: boolean | null; required: Record<string, unknown>; actual: Record<string, unknown> | null }>; unresolved: Array<Record<string, unknown>> } | null;
  alignment: Array<{ affinity: DefinitionRefDto; strengthKeys: string[]; weaknessKeys: string[]; explicitAccess: boolean }>;
}
export interface SpellCatalogDto {
  targeting: SpellComponentOptionDto[];
  effects: SpellComponentOptionDto[];
  traits: SpellComponentOptionDto[];
  durations: SpellComponentOptionDto[];
  castingConditions: SpellComponentOptionDto[];
  affinities: Array<{
    affinity: DefinitionRefDto;
    rank: string;
    role: string;
    strengths: Array<{ strengthKey: string; matchAny: string[] }>;
    weaknesses: Array<{ weaknessKey: string; matchAny: string[]; severity: string | null; activationPenaltyPercent: number | null }>;
    rankRule: { strengthDiscountPercent: number | null; effectCapacity: number | null; traitCapacity: number | null } | null;
  }>;
  arcana: { skillKey: string | null; rankKey: string | null; ranks: Array<{ rankKey: string; effectCapacity: number | null; traitCapacity: number | null; conditionCapacity: number | null }> };
  keywords: string[];
  vocabularies: { authorities: string[]; chainBehaviors: string[]; chainFailurePolicies: string[]; traitScopeTargets: Record<string, string | null> };
  performanceCondition: { present: boolean; definitions: DefinitionRefDto[] };
}
export interface SignatureSpellBuilderDto extends SignatureSpellDetailDto {
  catalog: SpellCatalogDto;
  stats: Record<string, number>;
}

const spellPath = (id: string, spellId: string, tail = "") => `/api/characters/${enc(id)}/spells/${enc(spellId)}${tail}`;
export const getAbilities = async (id: string) => (await request<CharacterAbilitiesDto>("GET", `/api/characters/${enc(id)}/abilities`)).data;
export const createSpell = async (id: string, name: string) => (await request<SignatureSpellDetailDto>("POST", `/api/characters/${enc(id)}/spells`, { name })).data;
export const getSpell = async (id: string, spellId: string) => (await request<SignatureSpellDetailDto>("GET", spellPath(id, spellId))).data;
export const getSpellBuilder = async (id: string, spellId: string) => (await request<SignatureSpellBuilderDto>("GET", spellPath(id, spellId, "/builder"))).data;
/** Saves the selections (or `null` to discard a rebuild); the server re-evaluates — nothing derived is ever sent. */
export const saveSpellDraft = async (id: string, spellId: string, expectedVersion: number, draft: SignatureSpellDraftDto | null) => (await request<SignatureSpellDetailDto>("PUT", spellPath(id, spellId, "/draft"), { expectedVersion, draft })).data;
export const validateSpell = async (id: string, spellId: string, expectedVersion: number) => (await request<{ evaluation: SpellEvaluationDto; lockVersion: number }>("POST", spellPath(id, spellId, "/validate"), { expectedVersion })).data;
export const finalizeSpell = async (id: string, spellId: string, expectedVersion: number) => (await request<SignatureSpellDetailDto>("POST", spellPath(id, spellId, "/finalize"), { expectedVersion })).data;
export const rebuildSpell = async (id: string, spellId: string, expectedVersion: number) => (await request<SignatureSpellDetailDto>("POST", spellPath(id, spellId, "/rebuild"), { expectedVersion })).data;
export const retireSpell = async (id: string, spellId: string, expectedVersion: number) => (await request<SignatureSpellDetailDto>("POST", spellPath(id, spellId, "/retire"), { expectedVersion })).data;
