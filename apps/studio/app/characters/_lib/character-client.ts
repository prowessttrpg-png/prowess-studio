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

type Method = "GET" | "POST" | "PUT";
async function request<T>(method: Method, path: string, body?: unknown): Promise<{ data: T; pagination?: { page: number; pageSize: number; total: number; totalPages: number } }> {
  const sent = await fetchJsonBody(path, method === "GET" ? undefined : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
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
