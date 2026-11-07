import { createHash } from "node:crypto";
import { CHARACTER_ERROR_CODES } from "@prowess/model";
import {
  buildCharacterAttackLibrary,
  buildCharacterSheetMechanics,
  buildPlayWorkspace,
  characterCoreOf,
  createPlayEvaluationCache,
  evaluatePlayOperation,
  readPlayOperation,
  readPlayRuntimeState,
  readSignatureManeuverDraft,
  readSignatureSpellDraft,
  signatureManeuverComponentRefs,
  signatureSpellComponentRefs,
  type PlayAbilitySource,
  type PlayContext,
  type PlayOperationOutcome,
  type PlayStored,
  type PlayWorkspaceView,
  type ProwessDefinitionRef,
  type SignatureManeuverDraft,
  type SignatureSpellDraft,
} from "@prowess/game";
import { commitPlayOperation, selectPlayEventByKey, selectPlayEvents, selectPlayRuntime, type StoredPlayEvent } from "./play-repository.js";
import { fail, namesOf, releaseSummary, type CharacterReleaseSummary } from "./service.js";
import { keywordCatalogFor } from "./signature-context.js";
import { selectSheetState } from "./sheet-repository.js";
import { selectSignatureAbilities, type StoredSignatureAbility } from "./signature-spell-repository.js";
import { libraryRefs, loadEquippedCharacter } from "./weapon-service.js";

/**
 * Character Play Workspace service (PAS-10 M6-WO10). Orchestration and persistence only:
 *
 *   Character + exact Release → the ONE equipped profile (M6-WO4 / WO6), sheet mechanics (M6-WO5), Attack Library (M6-WO6),
 *   stored Signature revisions (M6-WO7 / WO8), the sheet's current values and the stored Play runtime
 *   → @prowess/game `evaluatePlayOperation` / `buildPlayWorkspace` (every rule is theirs)
 *   → preview (no write) or ONE atomic commit (sheet values + runtime + one ledger event).
 *
 * The client supplies an operation (choices, targets, raw rolls), the versions it evaluated and an idempotency key. The
 * server re-evaluates everything; a stale version, a reused key or an unreadable stored state never writes.
 */

export interface PlayVersions {
  readonly runtimeVersion: number;
  readonly playStateVersion: number;
}

export interface CharacterPlayWorkspaceView {
  readonly character: { readonly id: string; readonly name: string; readonly level: number; readonly lockVersion: number };
  readonly release: CharacterReleaseSummary;
  readonly versions: PlayVersions;
  readonly workspace: PlayWorkspaceView;
  readonly recentEvents: readonly PlayEventView[];
}

export interface PlayEventView {
  readonly id: string;
  readonly sequence: number;
  readonly operationKind: string;
  readonly classification: string;
  readonly summary: string;
  readonly rulesetReleaseId: string;
  readonly runtimeVersion: number;
  readonly playStateVersion: number;
  readonly createdAt: string;
  /** The committed engine outcome exactly as recorded — never recalculated against a later revision. */
  readonly record: unknown;
}

const eventView = (e: StoredPlayEvent): PlayEventView => ({ id: e.id, sequence: e.sequence, operationKind: e.operationKind, classification: e.classification, summary: e.summary, rulesetReleaseId: e.rulesetReleaseId, runtimeVersion: e.runtimeVersion, playStateVersion: e.playStateVersion, createdAt: e.createdAt.toISOString(), record: e.record });

function revisionOf(a: StoredSignatureAbility) {
  const current = a.revisions.find((r) => r.id === a.currentRevisionId) ?? null;
  // A RETIRED Ability keeps its last revision as history (it is never cast).
  return current ?? (a.status === "RETIRED" ? (a.revisions.at(-1) ?? null) : null);
}

function sourcesOf<D>(all: readonly StoredSignatureAbility[], kind: "SPELL" | "MANEUVER", read: (raw: unknown) => D | null, nameOf: (d: D) => string): PlayAbilitySource<D>[] {
  return all
    .filter((a) => a.abilityKind === kind)
    .map((a) => {
      const rev = revisionOf(a);
      const draft = rev === null ? null : read(rev.payload);
      return { abilityId: a.id, name: draft === null ? "Unreadable revision" : nameOf(draft), status: a.status as PlayAbilitySource<D>["status"], revisionNumber: rev?.revisionNumber ?? null, revisionReleaseId: rev?.characterReleaseId ?? null, draft, usedSlots: all.filter((x) => x.status === "ACTIVE" && x.id !== a.id).length };
    });
}

const spellOf = (raw: unknown): SignatureSpellDraft | null => {
  const r = readSignatureSpellDraft(raw);
  return r.ok ? r.value : null;
};
const maneuverOf = (raw: unknown): SignatureManeuverDraft | null => {
  const r = readSignatureManeuverDraft(raw);
  return r.ok ? r.value : null;
};

interface Loaded {
  readonly ctx: PlayContext;
  readonly stored: PlayStored;
  readonly versions: PlayVersions;
  readonly character: CharacterPlayWorkspaceView["character"];
  readonly releaseId: string;
}

/** Everything one evaluation needs, read in one pass. Read-only: never creates a sheet or runtime row. */
async function load(characterId: string): Promise<Loaded> {
  const equipped = await loadEquippedCharacter(characterId);
  const { c, bundle, ruleset, history, base, profile, choice } = equipped;
  const mechanics = buildCharacterSheetMechanics({ bundle, ruleset, profile });
  const attackLibrary = buildCharacterAttackLibrary({ bundle, characterProfile: base, loadout: choice });
  const maneuverAttackLibrary = buildCharacterAttackLibrary({ bundle, characterProfile: profile, loadout: choice });
  const all = await selectSignatureAbilities(c.id);
  const spells = sourcesOf(all, "SPELL", spellOf, (d) => d.concept.name);
  const maneuvers = sourcesOf(all, "MANEUVER", maneuverOf, (d) => d.concept.name);
  const runtimeRefs = bundle.definitions.filter((d) => ["RESOURCE", "ACTION", "ACTION_IMPROVEMENT", "TERRAIN"].includes(d.definitionKind)).map((d) => ({ entityId: d.entityId, entityVersionId: d.entityVersionId, canonicalKey: d.canonicalKey, definitionKind: d.definitionKind, systemFamily: d.systemFamily }) as ProwessDefinitionRef);
  const names = await namesOf([...runtimeRefs, ...libraryRefs(attackLibrary), ...spells.flatMap((s) => (s.draft === null ? [] : signatureSpellComponentRefs(s.draft))), ...maneuvers.flatMap((s) => (s.draft === null ? [] : [...signatureManeuverComponentRefs(s.draft)]))]);
  const sheet = await selectSheetState(c.id);
  const runtimeRow = await selectPlayRuntime(c.id);
  let runtime: PlayStored["runtime"] = null;
  if (runtimeRow !== null) {
    const read = readPlayRuntimeState(runtimeRow.state, { characterId: c.id });
    if (!read.ok) throw fail(CHARACTER_ERROR_CODES.PLAY_STATE_UNREADABLE, `The stored play state cannot be read (${read.reason}); it is kept unchanged for review.`);
    runtime = read.state;
  }
  const ctx: PlayContext = {
    characterId: c.id,
    releaseId: c.rulesetReleaseId,
    characterName: c.name,
    level: profile.level,
    advancementCount: history.length,
    bundle,
    ruleset,
    profile: base,
    equippedProfile: profile,
    maneuverAttackLibrary,
    attackLibrary,
    keywords: await keywordCatalogFor(bundle),
    spells,
    maneuvers,
    casterCore: characterCoreOf(profile),
    characterDie: profile.characterDie,
    characterDc: mechanics.combat.characterDc.value,
    mechanics,
    names,
    evaluations: createPlayEvaluationCache(),
  };
  return {
    ctx,
    stored: { sheetResources: sheet.playState?.resources ?? null, runtime },
    versions: { runtimeVersion: runtimeRow?.lockVersion ?? 0, playStateVersion: sheet.playState?.lockVersion ?? 0 },
    character: { id: c.id, name: c.name, level: c.level, lockVersion: c.lockVersion },
    releaseId: c.rulesetReleaseId,
  };
}

/** The workspace view over an already loaded context (its Ability evaluations are reused, never recomputed). */
async function viewOf(l: Loaded, stored: PlayStored, versions: PlayVersions): Promise<CharacterPlayWorkspaceView> {
  const recent = await selectPlayEvents(l.ctx.characterId, { before: null, limit: 25 });
  return { character: l.character, release: await releaseSummary(l.releaseId), versions, workspace: buildPlayWorkspace(l.ctx, stored), recentEvents: recent.map(eventView) };
}

/** The Play Workspace (§4) in ONE read. Read-only: it never creates, refreshes, advances or resolves anything. */
export async function getCharacterPlayWorkspace(characterId: string): Promise<CharacterPlayWorkspaceView> {
  const l = await load(characterId);
  return viewOf(l, l.stored, l.versions);
}

const version = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw fail(CHARACTER_ERROR_CODES.INVALID_INPUT, `${field} is a non-negative whole number (0 when nothing has been saved yet)`);
  return value;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function staleIf(l: Loaded, expected: PlayVersions): void {
  if (expected.runtimeVersion !== l.versions.runtimeVersion || expected.playStateVersion !== l.versions.playStateVersion) {
    throw fail(CHARACTER_ERROR_CODES.STALE_WRITE, `This Character's play state changed since it was evaluated (runtime v${String(l.versions.runtimeVersion)}, resources v${String(l.versions.playStateVersion)}). Reload and evaluate again.`);
  }
}

function operationOf(raw: unknown) {
  const read = readPlayOperation(raw);
  if (!read.ok) throw fail(CHARACTER_ERROR_CODES.INVALID_PLAY_OPERATION, read.message);
  return read.value;
}

/** Evaluates an operation WITHOUT writing (§16 Preview). The outcome is never an authorization to commit. */
export async function previewCharacterPlayOperation(characterId: string, input: { readonly operation: unknown; readonly expectedRuntimeVersion: unknown; readonly expectedPlayStateVersion: unknown }): Promise<{ readonly versions: PlayVersions; readonly outcome: PlayOperationOutcome }> {
  const expected = { runtimeVersion: version(input.expectedRuntimeVersion, "expectedRuntimeVersion"), playStateVersion: version(input.expectedPlayStateVersion, "expectedPlayStateVersion") };
  const operation = operationOf(input.operation);
  const l = await load(characterId);
  staleIf(l, expected);
  return { versions: l.versions, outcome: evaluatePlayOperation(l.ctx, l.stored, operation) };
}

const canonical = (v: unknown): string => (Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v !== null && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}` : JSON.stringify(v));

export interface PlayCommitResult {
  readonly committed: boolean;
  /** True when this idempotency key was already committed: the ORIGINAL event is returned and nothing is applied again. */
  readonly replayed: boolean;
  readonly outcome: PlayOperationOutcome | null;
  readonly event: PlayEventView | null;
  readonly workspace: CharacterPlayWorkspaceView;
}

/**
 * Commits ONE operation (§16 Commit): revalidates identity and versions, re-evaluates server-side, and — only for a
 * COMMITTABLE outcome — writes the sheet values, the runtime state and one ledger event in one transaction. A refused,
 * pending or unsupported outcome writes nothing and is returned as such.
 */
export async function commitCharacterPlayOperation(characterId: string, input: { readonly operation: unknown; readonly idempotencyKey: unknown; readonly expectedRuntimeVersion: unknown; readonly expectedPlayStateVersion: unknown }): Promise<PlayCommitResult> {
  if (typeof input.idempotencyKey !== "string" || !UUID.test(input.idempotencyKey)) throw fail(CHARACTER_ERROR_CODES.INVALID_INPUT, "idempotencyKey is a lowercase UUID chosen by the client for this submission");
  const expected = { runtimeVersion: version(input.expectedRuntimeVersion, "expectedRuntimeVersion"), playStateVersion: version(input.expectedPlayStateVersion, "expectedPlayStateVersion") };
  const operation = operationOf(input.operation);
  const requestHash = createHash("sha256").update(canonical({ operation: input.operation, expectedRuntimeVersion: expected.runtimeVersion, expectedPlayStateVersion: expected.playStateVersion })).digest("hex");
  const key = input.idempotencyKey;
  const replay = async (): Promise<PlayCommitResult> => {
    const prior = await selectPlayEventByKey(characterId, key);
    if (prior === null) throw fail(CHARACTER_ERROR_CODES.STALE_WRITE, "This play state changed concurrently; reload and evaluate again.");
    if (prior.requestHash !== requestHash) throw fail(CHARACTER_ERROR_CODES.PLAY_IDEMPOTENCY_CONFLICT, "This idempotency key was already used for a different play operation; nothing was applied.");
    return { committed: true, replayed: true, outcome: null, event: eventView(prior), workspace: await getCharacterPlayWorkspace(characterId) };
  };
  if ((await selectPlayEventByKey(characterId, key)) !== null) return replay();

  const l = await load(characterId);
  staleIf(l, expected);
  const outcome = evaluatePlayOperation(l.ctx, l.stored, operation);
  if (outcome.status !== "COMMITTABLE" || outcome.runtimeAfter === null || outcome.resourcesAfter === null) return { committed: false, replayed: false, outcome, event: null, workspace: await viewOf(l, l.stored, l.versions) };

  // Sheet values change only through the one compare-and-set, and only when the operation changed one.
  const sheetKeys = new Set(l.ctx.mechanics.resources.filter((r) => r.maximum !== null).map((r) => r.resourceKey));
  const before = new Map(outcome.resourcesBefore.map((r) => [r.resourceKey, r.current]));
  const changed = outcome.resourcesAfter.filter((r) => sheetKeys.has(r.resourceKey) && before.get(r.resourceKey) !== r.current).map((r) => ({ resourceKey: r.resourceKey, current: r.current }));
  const initial = outcome.resourcesBefore.filter((r) => sheetKeys.has(r.resourceKey)).map((r) => ({ resourceKey: r.resourceKey, current: r.current }));
  const record = { contractVersion: outcome.contractVersion, status: outcome.status, operation: outcome.operation, summary: outcome.summary, reasons: outcome.reasons, resourcesBefore: outcome.resourcesBefore, resourcesAfter: outcome.resourcesAfter, source: outcome.source, trace: outcome.trace, pending: outcome.pending, inputs: outcome.inputs, releaseId: l.releaseId, rulesetProvenance: l.ctx.bundle.rulesetProvenance, advancementCount: l.ctx.advancementCount };
  const result = await commitPlayOperation({
    characterId: l.ctx.characterId,
    rulesetReleaseId: l.releaseId,
    expectedRuntimeVersion: expected.runtimeVersion,
    expectedPlayStateVersion: expected.playStateVersion,
    resources: changed.length === 0 ? null : { values: changed, initial },
    state: outcome.runtimeAfter as unknown as object,
    event: { idempotencyKey: key, requestHash, operationKind: outcome.operation.kind, classification: outcome.classification as string, summary: outcome.summary.slice(0, 2000) || outcome.operation.kind, record: JSON.parse(JSON.stringify(record)) as object },
  });
  if (result.outcome === "duplicate") return replay();
  if (result.outcome === "stale") throw fail(CHARACTER_ERROR_CODES.STALE_WRITE, `This Character's ${result.which === "PLAY_STATE" ? "resources" : "play state"} changed while the operation was evaluated; nothing was applied. Reload and evaluate again.`);
  // The committed state, presented from the SAME loaded context (exactly what was just written; nothing re-derived).
  const sheetAfter = changed.length === 0 ? l.stored.sheetResources : outcome.resourcesAfter.filter((r) => sheetKeys.has(r.resourceKey)).map((r) => ({ resourceKey: r.resourceKey, current: r.current }));
  const committed = { sheetResources: sheetAfter, runtime: outcome.runtimeAfter };
  return { committed: true, replayed: false, outcome, event: eventView(result.event), workspace: await viewOf(l, committed, { runtimeVersion: result.runtimeVersion, playStateVersion: result.playStateVersion }) };
}

/** The Character's committed gameplay history, newest first (read-only). */
export async function listCharacterPlayEvents(characterId: string, query: { readonly before: unknown; readonly limit: unknown }): Promise<{ readonly events: readonly PlayEventView[] }> {
  const l = await load(characterId);
  const before = query.before === null || query.before === undefined ? null : version(query.before, "before");
  const limit = query.limit === null || query.limit === undefined ? 50 : version(query.limit, "limit");
  if (limit < 1 || limit > 200) throw fail(CHARACTER_ERROR_CODES.INVALID_INPUT, "limit is 1–200");
  return { events: (await selectPlayEvents(l.ctx.characterId, { before, limit })).map(eventView) };
}
