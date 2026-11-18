/**
 * Encounter API client (M7-WO1) — the ONLY way encounter UI code talks to data. Every call goes through the shared Studio
 * transport to the Studio HTTP API; nothing under `app/encounters/` imports the database package, Prisma or a domain
 * package (scripts/check-architecture.mjs, m7-wo1-static). Deliberately thin: readiness, eligibility and Release
 * compatibility are the server's decisions — this client never computes or sends them.
 */
import { fetchJsonBody } from "../../../src/api-client/http";

export class EncounterApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "EncounterApiError";
    this.code = code;
    this.status = status;
  }
}

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<{ data: T; pagination?: { page: number; pageSize: number; total: number; totalPages: number } }> {
  const init: RequestInit | undefined = method === "GET" ? undefined : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) };
  const sent = await fetchJsonBody(path, init);
  if (sent.kind === "NETWORK_FAILURE") throw new EncounterApiError("NETWORK_ERROR", "Could not reach the server. Your change was not confirmed; try again.", 0);
  if (sent.kind === "UNREADABLE_BODY") throw new EncounterApiError("INVALID_RESPONSE", "The server returned an unreadable response.", sent.response.status);
  const json = sent.body as Record<string, unknown> | null;
  if (!sent.response.ok) throw new EncounterApiError(json !== null && typeof json.code === "string" ? json.code : "UNKNOWN_ERROR", json !== null && typeof json.message === "string" ? json.message : "The request failed.", sent.response.status);
  return json as { data: T; pagination?: { page: number; pageSize: number; total: number; totalPages: number } };
}
const enc = encodeURIComponent;

// --- DTOs (server shapes, rendered as given) ------------------------------------------------------------------------

export interface EncounterReleaseDto {
  id: string;
  rulesetId: string;
  rulesetName: string;
  releaseNumber: number;
  versionLabel: string;
  channel: string;
}
export interface ReadinessItemDto {
  code: string;
  message: string;
  participantId: string | null;
  sideId: string | null;
}
export interface EncounterParticipantDto {
  id: string;
  sideId: string | null;
  addedAt: string;
  character: { id: string; name: string; level: number; status: "DRAFT" | "CORE_COMPLETE"; rulesetReleaseId: string };
  standalone: { readable: boolean; combatActive: boolean; round: number | null } | null;
}
export interface EncounterSideDto {
  id: string;
  name: string;
  ordinal: number;
  participantIds: string[];
}
export interface EncounterEventDto {
  id: string;
  sequence: number;
  kind: string;
  summary: string;
  encounterVersion: number;
  record: unknown;
  createdAt: string;
}
export interface EncounterDto {
  contractVersion: number;
  id: string;
  name: string;
  notes: string | null;
  status: "PREPARATION" | "ARCHIVED";
  archivedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  release: EncounterReleaseDto;
  sides: EncounterSideDto[];
  participants: EncounterParticipantDto[];
  readiness: { state: "PREPARED" | "NOT_PREPARED" | "ARCHIVED"; blocking: ReadinessItemDto[]; warnings: ReadinessItemDto[]; combat: { available: false; reason: string } };
  recentEvents: EncounterEventDto[];
}
export interface EncounterListItemDto {
  id: string;
  name: string;
  status: "PREPARATION" | "ARCHIVED";
  version: number;
  updatedAt: string;
  sideCount: number;
  participantCount: number;
  release: EncounterReleaseDto;
}
export interface EncounterCommandResultDto {
  committed: true;
  replayed: boolean;
  event: EncounterEventDto;
  encounter: EncounterDto;
}
export interface EncounterCandidateDto {
  id: string;
  name: string;
  level: number;
  status: "DRAFT" | "CORE_COMPLETE";
  release: EncounterReleaseDto;
  eligibility: "ELIGIBLE" | "ALREADY_MEMBER" | "NOT_COMPLETE" | "OTHER_RELEASE";
  reason: string | null;
}
export type EncounterCommand =
  | { kind: "UPDATE_METADATA"; name: string; notes: string | null }
  | { kind: "ADD_SIDE"; name: string }
  | { kind: "RENAME_SIDE"; sideId: string; name: string }
  | { kind: "REMOVE_SIDE"; sideId: string }
  | { kind: "ADD_PARTICIPANT"; characterId: string; sideId: string | null }
  | { kind: "MOVE_PARTICIPANT"; participantId: string; sideId: string | null }
  | { kind: "REMOVE_PARTICIPANT"; participantId: string }
  | { kind: "ARCHIVE" };

// --- calls ----------------------------------------------------------------------------------------------------------

export const listEncounters = async (q: { page?: number; pageSize?: number; q?: string; status?: "ALL" | "PREPARATION" | "ARCHIVED" } = {}) => {
  const params = new URLSearchParams();
  params.set("page", String(q.page ?? 1));
  params.set("pageSize", String(q.pageSize ?? 25));
  if (q.q !== undefined && q.q.trim() !== "") params.set("q", q.q.trim());
  if (q.status !== undefined && q.status !== "ALL") params.set("status", q.status);
  const r = await request<EncounterListItemDto[]>("GET", `/api/encounters?${params.toString()}`);
  return { items: r.data, pagination: r.pagination ?? { page: 1, pageSize: r.data.length, total: r.data.length, totalPages: 1 } };
};
export const createEncounter = async (body: { name: string; notes: string | null; rulesetReleaseId: string; idempotencyKey: string }) => (await request<EncounterCommandResultDto>("POST", "/api/encounters", body)).data;
export const getEncounter = async (id: string) => (await request<EncounterDto>("GET", `/api/encounters/${enc(id)}`)).data;
export const commandEncounter = async (id: string, command: EncounterCommand, expectedVersion: number, idempotencyKey: string) =>
  (await request<EncounterCommandResultDto>("POST", `/api/encounters/${enc(id)}/commands`, { command, expectedVersion, idempotencyKey })).data;
export const searchEncounterCandidates = async (id: string, q: string) => (await request<{ candidates: EncounterCandidateDto[] }>("GET", `/api/encounters/${enc(id)}/characters${q.trim() === "" ? "" : `?q=${enc(q.trim())}`}`)).data.candidates;
export const listEncounterEvents = async (id: string, before: number | null = null) => (await request<{ events: EncounterEventDto[] }>("GET", `/api/encounters/${enc(id)}/events?limit=50${before === null ? "" : `&before=${before}`}`)).data.events;

/** A fresh idempotency key for ONE submission (reused only to retry that same, unconfirmed submission). */
export const newSubmissionKey = (): string => crypto.randomUUID();

/** Readable Release identity (never an id in ordinary text). */
export const releaseLabel = (r: EncounterReleaseDto) => `${r.rulesetName} · Release ${r.releaseNumber} (${r.versionLabel})`;
