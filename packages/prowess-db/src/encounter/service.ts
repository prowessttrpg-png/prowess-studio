import { createHash } from "node:crypto";
import { DomainError, ENCOUNTER_ERROR_CODES as E, type EncounterErrorCode } from "@prowess/model";
import { readPlayRuntimeState } from "@prowess/game";
import { isUuid, selectReleaseById } from "../ruleset-release/repository.js";
import { verifyRulesetReleaseManifestHash } from "../ruleset-release/service.js";
import { selectRulesetById } from "../ruleset/repository.js";
import {
  ENCOUNTER_STATUSES,
  applyEncounterCommand,
  countEncounters,
  insertEncounter,
  selectCharacterCandidates,
  selectCharacterForRoster,
  selectEncounter,
  selectEncounterEvents,
  selectEncounterPage,
  selectEventByKey,
  selectPlayRuntimes,
  type EncounterStatus,
  type EventInput,
  type RosterChange,
  type StoredEncounter,
  type StoredEncounterEvent,
} from "./repository.js";

/**
 * Encounter service (M7-WO1) — encounter PREPARATION: a name, notes, ONE exact published Release, named sides and
 * memberships of completed Characters on that same Release, with a server-derived readiness summary.
 *
 * Boundaries (docs/architecture/m7-wo1-encounter-foundation.md):
 *   - A membership is a REFERENCE. Nothing here reads for writing, initializes, resets, refills or reconciles a
 *     Character's resources, play runtime, Active Magic or play events — their only writers stay the M6 services.
 *   - Release compatibility is exact identity (`rulesetReleaseId` equality), revalidated on every mutation and every
 *     readiness read — never a name, a payload resemblance or a content-pack receipt.
 *   - No combat: there is no initiative, round, turn, cost or damage here. Readiness never claims combat can begin.
 *   - Commands are closed shapes; derived values (readiness, versions of other rows) are never inputs. Each command is
 *     one transaction under the encounter's compare-and-set, with one append-only event; a retried idempotency key
 *     returns the original event and applies nothing again.
 */

export const ENCOUNTER_CONTRACT_VERSION = 1 as const;
export const ENCOUNTER_COMMAND_KINDS = ["UPDATE_METADATA", "ADD_SIDE", "RENAME_SIDE", "REMOVE_SIDE", "ADD_PARTICIPANT", "MOVE_PARTICIPANT", "REMOVE_PARTICIPANT", "ARCHIVE"] as const;
export type EncounterCommandKind = (typeof ENCOUNTER_COMMAND_KINDS)[number];
export const ENCOUNTER_LIST_STATUSES = ["ALL", ...ENCOUNTER_STATUSES] as const;

const MAX_NAME = 120;
const MAX_NOTES = 4000;
const MAX_SIDE_NAME = 80;
const MAX_SIDES = 12;
const MAX_PARTICIPANTS = 64;
const MAX_SEARCH = 120;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const fail = (code: EncounterErrorCode, message: string) => new DomainError(code, message);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const canonical = (v: unknown): string => (Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : isRecord(v) ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v));
const hashOf = (v: unknown) => createHash("sha256").update(canonical(v)).digest("hex");

function closed(value: unknown, what: string, allowed: readonly string[], required: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) throw fail(E.INVALID_INPUT, `${what} is an object`);
  const unknown = Object.keys(value).filter((k) => !allowed.includes(k));
  if (unknown.length > 0) throw fail(E.INVALID_INPUT, `${what} has unknown field(s): ${unknown.join(", ")}`);
  for (const k of required) if (value[k] === undefined) throw fail(E.INVALID_INPUT, `${what}.${k} is required`);
  return value;
}
function readText(value: unknown, what: string, max: number): string {
  if (typeof value !== "string" || value.trim() === "" || value.trim().length > max) throw fail(E.INVALID_INPUT, `${what} is required text (1–${max} characters)`);
  return value.trim();
}
function readNotes(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > MAX_NOTES) throw fail(E.INVALID_INPUT, `notes is optional text (≤ ${MAX_NOTES} characters)`);
  return value.trim() === "" ? null : value;
}
function readId(value: unknown, what: string): string {
  if (typeof value !== "string" || !UUID.test(value.trim().toLowerCase())) throw fail(E.INVALID_INPUT, `${what} is an exact id`);
  return value.trim().toLowerCase();
}
function readOptionalSide(value: unknown): string | null {
  return value === null ? null : readId(value, "sideId");
}
function readKey(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw fail(E.INVALID_INPUT, "idempotencyKey is a lowercase UUID chosen by the client for this submission");
  return value;
}
function readVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw fail(E.INVALID_INPUT, "expectedVersion is the encounter version the command was prepared against");
  return value;
}
function encounterId(id: string): string {
  const nid = id.trim().toLowerCase();
  if (!isUuid(nid)) throw fail(E.NOT_FOUND, `Encounter not found: ${id}`);
  return nid;
}

// ---- views -------------------------------------------------------------------------------------------------------------

export interface EncounterReleaseView {
  readonly id: string;
  readonly rulesetId: string;
  readonly rulesetName: string;
  readonly releaseNumber: number;
  readonly versionLabel: string;
  readonly channel: string;
}
export interface ReadinessItem {
  readonly code: string;
  readonly message: string;
  readonly participantId: string | null;
  readonly sideId: string | null;
}
export interface EncounterReadiness {
  /** PREPARED = no blocking item for a future combat start. It is NOT a claim that combat can begin (WO2). */
  readonly state: "PREPARED" | "NOT_PREPARED" | "ARCHIVED";
  readonly blocking: readonly ReadinessItem[];
  readonly warnings: readonly ReadinessItem[];
  readonly combat: { readonly available: false; readonly reason: string };
}
export interface EncounterParticipantView {
  readonly id: string;
  readonly sideId: string | null;
  readonly addedAt: Date;
  readonly character: { readonly id: string; readonly name: string; readonly level: number; readonly status: "DRAFT" | "CORE_COMPLETE"; readonly rulesetReleaseId: string };
  /** The Character's standalone play runtime as stored (read-only): whether its own combat timing is active. */
  readonly standalone: { readonly readable: boolean; readonly combatActive: boolean; readonly round: number | null } | null;
}
export interface EncounterSideView {
  readonly id: string;
  readonly name: string;
  readonly ordinal: number;
  readonly participantIds: readonly string[];
}
export interface EncounterEventView {
  readonly id: string;
  readonly sequence: number;
  readonly kind: string;
  readonly summary: string;
  readonly encounterVersion: number;
  readonly record: unknown;
  readonly createdAt: Date;
}
export interface EncounterView {
  readonly contractVersion: typeof ENCOUNTER_CONTRACT_VERSION;
  readonly id: string;
  readonly name: string;
  readonly notes: string | null;
  readonly status: EncounterStatus;
  readonly archivedAt: Date | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly release: EncounterReleaseView;
  readonly sides: readonly EncounterSideView[];
  readonly participants: readonly EncounterParticipantView[];
  readonly readiness: EncounterReadiness;
  readonly recentEvents: readonly EncounterEventView[];
}
export interface EncounterListItem {
  readonly id: string;
  readonly name: string;
  readonly status: EncounterStatus;
  readonly version: number;
  readonly updatedAt: Date;
  readonly sideCount: number;
  readonly participantCount: number;
  readonly release: EncounterReleaseView;
}
export interface EncounterCommandResult {
  readonly committed: true;
  readonly replayed: boolean;
  readonly event: EncounterEventView;
  readonly encounter: EncounterView;
}
export interface EncounterCandidate {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  readonly status: "DRAFT" | "CORE_COMPLETE";
  readonly release: EncounterReleaseView;
  /** Server-decided: whether this Character may join THIS encounter now, and why not. */
  readonly eligibility: "ELIGIBLE" | "ALREADY_MEMBER" | "NOT_COMPLETE" | "OTHER_RELEASE";
  readonly reason: string | null;
}

type ReleaseRow = StoredEncounter["rulesetRelease"];
const releaseView = (r: ReleaseRow): EncounterReleaseView => ({ id: r.id, rulesetId: r.ruleset.id, rulesetName: r.ruleset.name, releaseNumber: r.releaseNumber, versionLabel: r.versionLabel, channel: String(r.channel) });
const eventView = (e: StoredEncounterEvent): EncounterEventView => ({ id: e.id, sequence: e.sequence, kind: e.kind, summary: e.summary, encounterVersion: e.encounterVersion, record: e.record, createdAt: e.createdAt });
const statusOf = (c: { coreCreationCompletedAt: Date | null }) => (c.coreCreationCompletedAt === null ? ("DRAFT" as const) : ("CORE_COMPLETE" as const));
const COMBAT_UNAVAILABLE = "Starting combat is not part of encounter preparation. Side initiative, rounds and turns arrive with M7-WO2.";

async function requireEncounter(id: string): Promise<StoredEncounter> {
  const row = await selectEncounter(encounterId(id));
  if (row === null) throw fail(E.NOT_FOUND, `Encounter not found: ${id}`);
  return row;
}

/** Readiness is DERIVED on every read from the stored roster, the Characters as they are now and the Release itself. */
async function readinessOf(row: StoredEncounter, participants: readonly EncounterParticipantView[], integrity: boolean): Promise<EncounterReadiness> {
  const blocking: ReadinessItem[] = [];
  const warnings: ReadinessItem[] = [];
  const item = (code: string, message: string, participantId: string | null = null, sideId: string | null = null): ReadinessItem => ({ code, message, participantId, sideId });
  if (row.status === "ARCHIVED") return { state: "ARCHIVED", blocking: [item("ARCHIVED", "This encounter is archived: a read-only historical record.")], warnings: [], combat: { available: false, reason: COMBAT_UNAVAILABLE } };
  if (!integrity) blocking.push(item("RELEASE_INTEGRITY_FAILED", "The encounter's Release does not match its stored manifest hash; nothing can be prepared on it."));
  if (row.sides.length === 0) blocking.push(item("NO_SIDES", "Add at least one side and assign participants to sides."));
  if (participants.length === 0) blocking.push(item("EMPTY_ROSTER", "The roster is empty: add completed Characters from this encounter's Release."));
  for (const p of participants) {
    const label = p.character.name;
    if (p.character.rulesetReleaseId !== row.rulesetReleaseId) blocking.push(item("PARTICIPANT_RELEASE_MISMATCH", `${label} is not on this encounter's Release.`, p.id));
    if (p.character.status !== "CORE_COMPLETE") blocking.push(item("PARTICIPANT_NOT_COMPLETE", `${label} has not completed core creation.`, p.id));
    if (p.sideId === null) blocking.push(item("UNASSIGNED_PARTICIPANT", `${label} is not assigned to a side.`, p.id));
    if (p.standalone !== null && !p.standalone.readable) blocking.push(item("PARTICIPANT_PLAY_STATE_UNSUPPORTED", `${label}'s saved play state cannot be read; open its Play Workspace to review it.`, p.id));
    if (p.standalone?.combatActive === true) warnings.push(item("STANDALONE_COMBAT_ACTIVE", `${label} is in standalone combat in its own Play Workspace${p.standalone.round === null ? "" : ` (round ${p.standalone.round})`}. Preparing this encounter does not change or end it; WO2 defines how combat moves into an encounter.`, p.id));
  }
  for (const s of row.sides) if (!participants.some((p) => p.sideId === s.id)) warnings.push(item("EMPTY_SIDE", `Side “${s.name}” has no participants.`, null, s.id));
  return { state: blocking.length === 0 ? "PREPARED" : "NOT_PREPARED", blocking, warnings, combat: { available: false, reason: COMBAT_UNAVAILABLE } };
}

async function viewOf(row: StoredEncounter): Promise<EncounterView> {
  const runtimes = new Map((await selectPlayRuntimes(row.participants.map((p) => p.characterId))).map((r) => [r.characterId, r]));
  const participants: EncounterParticipantView[] = row.participants.map((p) => {
    const runtime = runtimes.get(p.characterId);
    let standalone: EncounterParticipantView["standalone"] = null;
    if (runtime !== undefined) {
      const read = readPlayRuntimeState(runtime.state, { characterId: p.characterId });
      standalone = read.ok && runtime.rulesetReleaseId === p.character.rulesetReleaseId ? { readable: true, combatActive: read.state.combat.active, round: read.state.combat.round } : { readable: false, combatActive: false, round: null };
    }
    return { id: p.id, sideId: p.sideId, addedAt: p.createdAt, character: { id: p.character.id, name: p.character.name, level: p.character.level, status: statusOf(p.character), rulesetReleaseId: p.character.rulesetReleaseId }, standalone };
  });
  const integrity = row.status === "ARCHIVED" ? true : (await verifyRulesetReleaseManifestHash(row.rulesetReleaseId)).valid;
  const events = await selectEncounterEvents(row.id, { before: null, limit: 20 });
  return {
    contractVersion: ENCOUNTER_CONTRACT_VERSION,
    id: row.id,
    name: row.name,
    notes: row.notes,
    status: row.status as EncounterStatus,
    archivedAt: row.archivedAt,
    version: row.lockVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    release: releaseView(row.rulesetRelease),
    sides: row.sides.map((s) => ({ id: s.id, name: s.name, ordinal: s.ordinal, participantIds: participants.filter((p) => p.sideId === s.id).map((p) => p.id) })),
    participants,
    readiness: await readinessOf(row, participants, integrity),
    recentEvents: events.map(eventView),
  };
}

// ---- reads -------------------------------------------------------------------------------------------------------------

/** One encounter with its roster, derived readiness and recent history. Read-only. */
export async function getEncounter(id: string): Promise<EncounterView> {
  return viewOf(await requireEncounter(id));
}

export async function listEncounters(query: { readonly page: number; readonly pageSize: number; readonly search?: unknown; readonly status?: unknown }): Promise<{ items: EncounterListItem[]; total: number; page: number; pageSize: number }> {
  const raw = query.search ?? null;
  if (raw !== null && typeof raw !== "string") throw fail(E.INVALID_INPUT, "search is text");
  const search = raw === null || raw.trim() === "" ? null : raw.trim();
  if (search !== null && search.length > MAX_SEARCH) throw fail(E.INVALID_INPUT, `search is at most ${MAX_SEARCH} characters`);
  const status = query.status ?? "ALL";
  if (typeof status !== "string" || !(ENCOUNTER_LIST_STATUSES as readonly string[]).includes(status)) throw fail(E.INVALID_INPUT, `status is one of ${ENCOUNTER_LIST_STATUSES.join(", ")}`);
  const filter = { search, status: status as "ALL" | EncounterStatus };
  const [total, rows] = await Promise.all([countEncounters(filter), selectEncounterPage((query.page - 1) * query.pageSize, query.pageSize, filter)]);
  return {
    items: rows.map((r) => ({ id: r.id, name: r.name, status: r.status as EncounterStatus, version: r.lockVersion, updatedAt: r.updatedAt, sideCount: r._count.sides, participantCount: r._count.participants, release: releaseView(r.rulesetRelease) })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function listEncounterEvents(id: string, options: { readonly before?: unknown; readonly limit?: unknown }): Promise<{ events: EncounterEventView[] }> {
  const row = await requireEncounter(id);
  const before = options.before === undefined || options.before === null ? null : Number(options.before);
  const limit = options.limit === undefined || options.limit === null ? 50 : Number(options.limit);
  if (before !== null && (!Number.isSafeInteger(before) || before < 1)) throw fail(E.INVALID_INPUT, "before is a sequence number");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw fail(E.INVALID_INPUT, "limit is 1–200");
  return { events: (await selectEncounterEvents(row.id, { before, limit })).map(eventView) };
}

/** Characters matching a name, each with the server's decision whether it may join THIS encounter. Read-only. */
export async function listEncounterCandidates(id: string, query: { readonly search?: unknown }): Promise<{ candidates: EncounterCandidate[] }> {
  const row = await requireEncounter(id);
  const raw = query.search ?? null;
  if (raw !== null && typeof raw !== "string") throw fail(E.INVALID_INPUT, "search is text");
  const search = raw === null || raw.trim() === "" ? null : raw.trim();
  if (search !== null && search.length > MAX_SEARCH) throw fail(E.INVALID_INPUT, `search is at most ${MAX_SEARCH} characters`);
  const members = new Set(row.participants.map((p) => p.characterId));
  const release = releaseView(row.rulesetRelease);
  const candidates = (await selectCharacterCandidates(search, 25)).map((c): EncounterCandidate => {
    const status = statusOf(c);
    const other = releaseView(c.rulesetRelease);
    const [eligibility, reason]: [EncounterCandidate["eligibility"], string | null] = members.has(c.id)
      ? ["ALREADY_MEMBER", "Already in this encounter."]
      : c.rulesetReleaseId !== row.rulesetReleaseId
        ? ["OTHER_RELEASE", `Built on ${other.rulesetName} Release ${other.releaseNumber} (${other.versionLabel}); this encounter uses ${release.rulesetName} Release ${release.releaseNumber} (${release.versionLabel}). Prepare an encounter on the Character's Release instead.`]
        : status !== "CORE_COMPLETE"
          ? ["NOT_COMPLETE", "Core creation is not complete yet."]
          : ["ELIGIBLE", null];
    return { id: c.id, name: c.name, level: c.level, status, release: other, eligibility, reason };
  });
  return { candidates };
}

// ---- writes ------------------------------------------------------------------------------------------------------------

/** Creates an encounter draft on one exact, integrity-verified Release. A retried key returns the original encounter. */
export async function createEncounter(input: { readonly name: unknown; readonly notes?: unknown; readonly rulesetReleaseId: unknown; readonly idempotencyKey: unknown }): Promise<EncounterCommandResult> {
  const name = readText(input.name, "name", MAX_NAME);
  const notes = readNotes(input.notes);
  const releaseId = readId(input.rulesetReleaseId, "rulesetReleaseId");
  const key = readKey(input.idempotencyKey);
  const requestHash = hashOf({ op: "CREATE", name, notes, rulesetReleaseId: releaseId });
  const replay = async (): Promise<EncounterCommandResult | null> => {
    const prior = await selectEventByKey(key);
    if (prior === null) return null;
    if (prior.requestHash !== requestHash) throw fail(E.IDEMPOTENCY_CONFLICT, "This idempotency key was already used for a different request; nothing was applied.");
    return { committed: true, replayed: true, event: eventView(prior), encounter: await getEncounter(prior.encounterId) };
  };
  const earlier = await replay();
  if (earlier !== null) return earlier;
  const release = await selectReleaseById(releaseId);
  if (release === null) throw fail(E.RELEASE_NOT_FOUND, `Release not found: ${releaseId}`);
  if (!(await verifyRulesetReleaseManifestHash(releaseId)).valid) throw fail(E.RELEASE_INTEGRITY_FAILED, "This Release's manifest does not match its stored hash; no encounter is prepared on it.");
  const ruleset = await selectRulesetById(release.rulesetId);
  const event: EventInput = {
    idempotencyKey: key,
    requestHash,
    kind: "ENCOUNTER_CREATED",
    summary: `Encounter “${name}” created on ${ruleset?.name ?? "Ruleset"} Release ${release.releaseNumber} (${release.versionLabel}).`,
    record: () => ({ contractVersion: ENCOUNTER_CONTRACT_VERSION, command: "CREATE", name, notes, rulesetReleaseId: releaseId, releaseNumber: release.releaseNumber, versionLabel: release.versionLabel }),
  };
  const out = await insertEncounter({ name, notes, rulesetReleaseId: releaseId, event });
  if (out.outcome === "duplicate") {
    const raced = await replay();
    if (raced !== null) return raced;
    throw fail(E.IDEMPOTENCY_CONFLICT, "This idempotency key was already used; nothing was applied.");
  }
  return { committed: true, replayed: false, event: eventView(out.event), encounter: await getEncounter(out.encounterId) };
}

type Command =
  | { readonly kind: "UPDATE_METADATA"; readonly name: string; readonly notes: string | null }
  | { readonly kind: "ADD_SIDE"; readonly name: string }
  | { readonly kind: "RENAME_SIDE"; readonly sideId: string; readonly name: string }
  | { readonly kind: "REMOVE_SIDE"; readonly sideId: string }
  | { readonly kind: "ADD_PARTICIPANT"; readonly characterId: string; readonly sideId: string | null }
  | { readonly kind: "MOVE_PARTICIPANT"; readonly participantId: string; readonly sideId: string | null }
  | { readonly kind: "REMOVE_PARTICIPANT"; readonly participantId: string }
  | { readonly kind: "ARCHIVE" };

/** The closed command contract: an unknown kind or field, or any derived value, is refused before anything is read. */
export function readEncounterCommand(value: unknown): Command {
  const head = closed(value, "command", ["kind", "name", "notes", "sideId", "characterId", "participantId"], ["kind"]);
  const kind = head.kind;
  if (typeof kind !== "string" || !(ENCOUNTER_COMMAND_KINDS as readonly string[]).includes(kind)) throw fail(E.INVALID_INPUT, `command.kind is one of ${ENCOUNTER_COMMAND_KINDS.join(", ")}`);
  switch (kind as EncounterCommandKind) {
    case "UPDATE_METADATA": {
      const c = closed(value, "UPDATE_METADATA", ["kind", "name", "notes"], ["kind", "name"]);
      return { kind: "UPDATE_METADATA", name: readText(c.name, "name", MAX_NAME), notes: readNotes(c.notes) };
    }
    case "ADD_SIDE":
      return { kind: "ADD_SIDE", name: readText(closed(value, "ADD_SIDE", ["kind", "name"], ["kind", "name"]).name, "side name", MAX_SIDE_NAME) };
    case "RENAME_SIDE": {
      const c = closed(value, "RENAME_SIDE", ["kind", "sideId", "name"], ["kind", "sideId", "name"]);
      return { kind: "RENAME_SIDE", sideId: readId(c.sideId, "sideId"), name: readText(c.name, "side name", MAX_SIDE_NAME) };
    }
    case "REMOVE_SIDE":
      return { kind: "REMOVE_SIDE", sideId: readId(closed(value, "REMOVE_SIDE", ["kind", "sideId"], ["kind", "sideId"]).sideId, "sideId") };
    case "ADD_PARTICIPANT": {
      const c = closed(value, "ADD_PARTICIPANT", ["kind", "characterId", "sideId"], ["kind", "characterId", "sideId"]);
      return { kind: "ADD_PARTICIPANT", characterId: readId(c.characterId, "characterId"), sideId: readOptionalSide(c.sideId) };
    }
    case "MOVE_PARTICIPANT": {
      const c = closed(value, "MOVE_PARTICIPANT", ["kind", "participantId", "sideId"], ["kind", "participantId", "sideId"]);
      return { kind: "MOVE_PARTICIPANT", participantId: readId(c.participantId, "participantId"), sideId: readOptionalSide(c.sideId) };
    }
    case "REMOVE_PARTICIPANT":
      return { kind: "REMOVE_PARTICIPANT", participantId: readId(closed(value, "REMOVE_PARTICIPANT", ["kind", "participantId"], ["kind", "participantId"]).participantId, "participantId") };
    case "ARCHIVE":
      closed(value, "ARCHIVE", ["kind"], ["kind"]);
      return { kind: "ARCHIVE" };
  }
}

const sideNamed = (row: StoredEncounter, id: string | null) => (id === null ? null : (row.sides.find((s) => s.id === id) ?? null));

/**
 * Applies one closed roster / lifecycle command. The server re-reads the encounter, the referenced Character and sides
 * and decides legality; the write is one transaction under the encounter's compare-and-set. A replayed key returns the
 * original event (`replayed: true`) without applying anything; the same key with a different request is refused.
 */
export async function commandEncounter(id: string, input: { readonly command: unknown; readonly expectedVersion: unknown; readonly idempotencyKey: unknown }): Promise<EncounterCommandResult> {
  const eid = encounterId(id);
  const command = readEncounterCommand(input.command);
  const expectedVersion = readVersion(input.expectedVersion);
  const key = readKey(input.idempotencyKey);
  const requestHash = hashOf({ encounterId: eid, command, expectedVersion });

  /** A retry of a command that has ALREADY committed (perhaps concurrently) returns its event; nothing applies again. */
  const replay = async (): Promise<EncounterCommandResult | null> => {
    const prior = await selectEventByKey(key);
    if (prior === null) return null;
    if (prior.encounterId !== eid || prior.requestHash !== requestHash) throw fail(E.IDEMPOTENCY_CONFLICT, "This idempotency key was already used for a different request; nothing was applied.");
    return { committed: true, replayed: true, event: eventView(prior), encounter: await getEncounter(eid) };
  };
  const earlier = await replay();
  if (earlier !== null) return earlier;

  const row = await requireEncounter(eid);
  if (row.status === "ARCHIVED") throw fail(E.ARCHIVED, "This encounter is archived: a read-only historical record.");
  if (row.lockVersion !== expectedVersion) {
    const raced = await replay();
    if (raced !== null) return raced;
    throw fail(E.STALE_WRITE, `This encounter changed since it was loaded (now at version ${row.lockVersion}). Reload it and review before saving again.`);
  }

  const base = { contractVersion: ENCOUNTER_CONTRACT_VERSION, command: command.kind } as const;
  const requireSide = (sideId: string | null) => {
    if (sideId === null) return null;
    const side = sideNamed(row, sideId);
    if (side === null) throw fail(E.SIDE_NOT_FOUND, "That side does not belong to this encounter.");
    return side;
  };
  const requireParticipant = (participantId: string) => {
    const p = row.participants.find((x) => x.id === participantId);
    if (p === undefined) throw fail(E.PARTICIPANT_NOT_FOUND, "That membership does not belong to this encounter.");
    return p;
  };
  const uniqueSideName = (name: string, except: string | null) => {
    if (row.sides.some((s) => s.id !== except && s.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw fail(E.DUPLICATE_SIDE_NAME, `This encounter already has a side named “${name}”.`);
  };

  let change: RosterChange;
  let kind: string;
  let summary: string;
  let record: EventInput["record"];
  switch (command.kind) {
    case "UPDATE_METADATA":
      change = { kind: "METADATA", name: command.name, notes: command.notes };
      kind = "METADATA_UPDATED";
      summary = command.name === row.name ? "Encounter notes updated." : `Encounter renamed “${row.name}” → “${command.name}”.`;
      record = () => ({ ...base, before: { name: row.name, notes: row.notes }, after: { name: command.name, notes: command.notes } });
      break;
    case "ADD_SIDE":
      if (row.sides.length >= MAX_SIDES) throw fail(E.INVALID_INPUT, `An encounter has at most ${MAX_SIDES} sides.`);
      uniqueSideName(command.name, null);
      change = { kind: "ADD_SIDE", name: command.name };
      kind = "SIDE_ADDED";
      summary = `Side “${command.name}” added.`;
      record = (created) => ({ ...base, sideId: created.sideId, name: command.name });
      break;
    case "RENAME_SIDE": {
      const side = requireSide(command.sideId)!;
      uniqueSideName(command.name, side.id);
      change = { kind: "RENAME_SIDE", sideId: side.id, name: command.name };
      kind = "SIDE_RENAMED";
      summary = `Side “${side.name}” renamed “${command.name}”.`;
      record = () => ({ ...base, sideId: side.id, before: side.name, after: command.name });
      break;
    }
    case "REMOVE_SIDE": {
      const side = requireSide(command.sideId)!;
      const members = row.participants.filter((p) => p.sideId === side.id);
      if (members.length > 0) throw fail(E.SIDE_NOT_EMPTY, `Side “${side.name}” still has ${members.length} participant(s). Move or remove them first; a side is never removed with its members.`);
      change = { kind: "REMOVE_SIDE", sideId: side.id };
      kind = "SIDE_REMOVED";
      summary = `Side “${side.name}” removed.`;
      record = () => ({ ...base, sideId: side.id, name: side.name, ordinal: side.ordinal });
      break;
    }
    case "ADD_PARTICIPANT": {
      const side = requireSide(command.sideId);
      const character = await selectCharacterForRoster(command.characterId);
      if (character === null) throw fail(E.CHARACTER_NOT_FOUND, `Character not found: ${command.characterId}`);
      if (character.rulesetReleaseId !== row.rulesetReleaseId) throw fail(E.CHARACTER_RELEASE_MISMATCH, `${character.name} is built on a different Release than this encounter. A Character joins only an encounter on its own exact Release; prepare an encounter on that Release instead.`);
      if (character.coreCreationCompletedAt === null) throw fail(E.CHARACTER_NOT_ELIGIBLE, `${character.name} has not completed core creation; only completed Characters can join an encounter.`);
      if (row.participants.some((p) => p.characterId === character.id)) throw fail(E.DUPLICATE_PARTICIPANT, `${character.name} is already in this encounter.`);
      if (row.participants.length >= MAX_PARTICIPANTS) throw fail(E.INVALID_INPUT, `An encounter has at most ${MAX_PARTICIPANTS} participants.`);
      change = { kind: "ADD_PARTICIPANT", characterId: character.id, sideId: side?.id ?? null, rulesetReleaseId: row.rulesetReleaseId };
      kind = "PARTICIPANT_ADDED";
      summary = side === null ? `${character.name} added to the roster (no side yet).` : `${character.name} added to “${side.name}”.`;
      record = (created) => ({ ...base, participantId: created.participantId, characterId: character.id, characterName: character.name, sideId: side?.id ?? null, sideName: side?.name ?? null });
      break;
    }
    case "MOVE_PARTICIPANT": {
      const p = requireParticipant(command.participantId);
      const to = requireSide(command.sideId);
      const from = sideNamed(row, p.sideId);
      if ((to?.id ?? null) === p.sideId) throw fail(E.INVALID_INPUT, `${p.character.name} is already ${to === null ? "unassigned" : `on “${to.name}”`}.`);
      change = { kind: "MOVE_PARTICIPANT", participantId: p.id, sideId: to?.id ?? null };
      kind = "PARTICIPANT_MOVED";
      summary = `${p.character.name} moved ${from === null ? "from no side" : `from “${from.name}”`} ${to === null ? "to no side" : `to “${to.name}”`}.`;
      record = () => ({ ...base, participantId: p.id, characterId: p.characterId, characterName: p.character.name, from: from === null ? null : { sideId: from.id, name: from.name }, to: to === null ? null : { sideId: to.id, name: to.name } });
      break;
    }
    case "REMOVE_PARTICIPANT": {
      const p = requireParticipant(command.participantId);
      const from = sideNamed(row, p.sideId);
      change = { kind: "REMOVE_PARTICIPANT", participantId: p.id };
      kind = "PARTICIPANT_REMOVED";
      summary = `${p.character.name} removed from the roster.`;
      record = () => ({ ...base, participantId: p.id, characterId: p.characterId, characterName: p.character.name, sideId: p.sideId, sideName: from?.name ?? null });
      break;
    }
    case "ARCHIVE":
      change = { kind: "ARCHIVE" };
      kind = "ENCOUNTER_ARCHIVED";
      summary = `Encounter “${row.name}” archived (read-only).`;
      record = () => ({ ...base, sides: row.sides.map((s) => ({ sideId: s.id, name: s.name })), participants: row.participants.map((p) => ({ participantId: p.id, characterId: p.characterId, characterName: p.character.name, sideId: p.sideId })) });
      break;
  }

  const out = await applyEncounterCommand({ encounterId: eid, expectedVersion, change, event: { idempotencyKey: key, requestHash, kind, summary, record } });
  if (out.outcome === "stale") {
    const raced = await replay();
    if (raced !== null) return raced;
    const now = await requireEncounter(eid);
    if (now.status === "ARCHIVED") throw fail(E.ARCHIVED, "This encounter was archived; it is read-only.");
    throw fail(E.STALE_WRITE, `This encounter changed since it was loaded (now at version ${now.lockVersion}). Reload it and review before saving again.`);
  }
  if (out.outcome === "duplicate") {
    const raced = await replay();
    if (raced !== null) return raced;
    throw fail(E.IDEMPOTENCY_CONFLICT, "This idempotency key was already used for a different request; nothing was applied.");
  }
  if (out.outcome === "conflict") {
    if (out.reason === "DUPLICATE_PARTICIPANT") throw fail(E.DUPLICATE_PARTICIPANT, "That Character is already in this encounter.");
    if (out.reason === "SIDE_NOT_EMPTY") throw fail(E.SIDE_NOT_EMPTY, "That side still has participants; move or remove them first.");
    throw fail(E.STALE_WRITE, "The roster changed while this command was applied; reload and review.");
  }
  return { committed: true, replayed: false, event: eventView(out.event), encounter: await getEncounter(eid) };
}
