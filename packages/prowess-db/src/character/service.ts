import { CHARACTER_ERROR_CODES, DomainError, RULESET_RELEASE_ERROR_CODES, type CharacterErrorCode } from "@prowess/model";
import {
  CHARACTER_CREATION_REQUIRED_DERIVED_STATISTICS,
  characterCreationContent,
  getCharacterCreationCapability,
  validateCharacterCreation,
  type CharacterCreationCandidate,
  type CharacterCreationCapability,
  type CharacterCreationResult,
  type ProwessDefinitionRef,
} from "@prowess/game";
import { materializeProwessDefinitionsFromRelease } from "../prowess-definition/service.js";
import { isUuid, selectReleaseById } from "../ruleset-release/repository.js";
import { verifyRulesetReleaseManifestHash } from "../ruleset-release/service.js";
import { selectRulesetById } from "../ruleset/repository.js";
import {
  countCharacters,
  insertCharacter,
  markCoreCreationComplete,
  replaceCreationInputs,
  selectCharacter,
  selectCharacterPage,
  selectVersionDisplay,
  updateProfile,
  type CharacterWithChildren,
  type WriteOutcome,
} from "./repository.js";

/**
 * Character service (PAS-10 M6-WO3). A Character is player state pinned to ONE exact, immutable RulesetRelease.
 *
 *   Character → exact RulesetRelease → its flattened, integrity-verified manifest → exact EntityVersions
 *
 * Every read and write resolves the Character's rules from ITS stored Release (never a Ruleset's latest Release, never
 * a latest revision). The pure M5-layer validator (`validateCharacterCreation`, @prowess/game) decides legality and
 * computes the derived preview through the Release's own DERIVED_STAT Definitions and the M4 Formula engine — this
 * module holds no formula, no Stat bound, no budget, no catalog. Only player CHOICES are persisted; derived values are
 * recalculated on every read. Writes are optimistic compare-and-set on `lockVersion`, atomic with their child rows.
 */

const MAX_NAME_LENGTH = 120;
const MAX_CONCEPT_LENGTH = 2000;

export interface CharacterReleaseSummary {
  readonly id: string;
  readonly rulesetId: string;
  readonly rulesetName: string;
  readonly releaseNumber: number;
  readonly versionLabel: string;
  readonly channel: string;
}

export interface CharacterStoredChoices {
  readonly ancestry: { readonly entityId: string; readonly entityVersionId: string } | null;
  readonly ancestryStatChoices: ReadonlyArray<{ readonly grantKey: string; readonly stat: string }>;
  readonly statAllocations: Readonly<Record<string, number>>;
  readonly skills: ReadonlyArray<{ readonly skill: { readonly entityId: string; readonly entityVersionId: string }; readonly rankKey: string; readonly sourceKind: string; readonly sourceGrantKey: string | null }>;
  readonly primaryAffinity: { readonly entityId: string; readonly entityVersionId: string } | null;
}

export interface CharacterDetail {
  readonly id: string;
  readonly name: string;
  readonly concept: string | null;
  readonly level: number;
  readonly lockVersion: number;
  readonly coreCreationCompletedAt: Date | null;
  readonly status: "DRAFT" | "CORE_COMPLETE";
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly release: CharacterReleaseSummary;
  /** What the player chose — exactly as stored. */
  readonly choices: CharacterStoredChoices;
  /** The same choices resolved against the Character's Release right now (validation, provenance, derived preview). */
  readonly resolution: CharacterCreationResult;
  /** Display names of the exact Definitions the resolution cites (presentation only). */
  readonly names: Readonly<Record<string, string>>;
}

export interface CharacterListItem {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  readonly status: "DRAFT" | "CORE_COMPLETE";
  readonly updatedAt: Date;
  readonly release: Omit<CharacterReleaseSummary, "rulesetId"> & { readonly rulesetId: string };
}

const fail = (code: CharacterErrorCode, message: string) => new DomainError(code, message);
const normalizeId = (v: string) => v.trim().toLowerCase();

function readName(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > MAX_NAME_LENGTH) throw fail(CHARACTER_ERROR_CODES.INVALID_INPUT, `name is required (1–${MAX_NAME_LENGTH} characters)`);
  return value.trim();
}
function readConcept(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > MAX_CONCEPT_LENGTH) throw fail(CHARACTER_ERROR_CODES.INVALID_INPUT, `concept is optional text (≤ ${MAX_CONCEPT_LENGTH} characters)`);
  return value;
}
function readExpectedLockVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw fail(CHARACTER_ERROR_CODES.INVALID_INPUT, "expectedLockVersion is the lockVersion the Character was loaded at");
  return value;
}

async function releaseSummary(releaseId: string): Promise<CharacterReleaseSummary> {
  const release = await selectReleaseById(releaseId);
  if (release === null) throw new DomainError(RULESET_RELEASE_ERROR_CODES.NOT_FOUND, `RulesetRelease not found: ${releaseId}`);
  const ruleset = await selectRulesetById(release.rulesetId);
  return { id: release.id, rulesetId: release.rulesetId, rulesetName: ruleset?.name ?? "", releaseNumber: release.releaseNumber, versionLabel: release.versionLabel, channel: release.channel };
}

/** The exact Release's materialized rules (integrity-verified by M2 / M4-WO2 on every load). */
async function releaseRules(releaseId: string) {
  return materializeProwessDefinitionsFromRelease(releaseId);
}

function choicesOf(c: CharacterWithChildren): CharacterStoredChoices {
  return {
    ancestry: c.ancestryEntityId && c.ancestryEntityVersionId ? { entityId: c.ancestryEntityId, entityVersionId: c.ancestryEntityVersionId } : null,
    ancestryStatChoices: c.ancestryStatChoices.map((x) => ({ grantKey: x.grantKey, stat: x.stat })),
    statAllocations: Object.fromEntries(c.statAllocations.map((a) => [a.stat, a.pointsSpent])),
    skills: c.skillRanks.map((s) => ({ skill: { entityId: s.skillEntityId, entityVersionId: s.skillEntityVersionId }, rankKey: s.rankKey, sourceKind: s.sourceKind, sourceGrantKey: s.sourceGrantKey })),
    primaryAffinity: c.primaryAffinityEntityId && c.primaryAffinityEntityVersionId ? { entityId: c.primaryAffinityEntityId, entityVersionId: c.primaryAffinityEntityVersionId } : null,
  };
}

/** Stored choices as a validator candidate. The stored rank is not an input: the Release decides each Skill's rank. */
const candidateOf = (choices: CharacterStoredChoices): CharacterCreationCandidate => ({
  ancestry: choices.ancestry,
  ancestryStatChoices: choices.ancestryStatChoices,
  statAllocations: choices.statAllocations,
  skills: choices.skills.map((s) => ({ skill: s.skill, sourceKind: s.sourceKind, sourceGrantKey: s.sourceGrantKey })),
  primaryAffinity: choices.primaryAffinity,
});

async function namesOf(refs: ReadonlyArray<ProwessDefinitionRef | null | undefined>): Promise<Record<string, string>> {
  const ids = refs.filter((r): r is ProwessDefinitionRef => r !== null && r !== undefined).map((r) => r.entityVersionId);
  return Object.fromEntries((await selectVersionDisplay(ids)).map((v) => [v.id, v.displayName]));
}

async function requireCharacter(id: string): Promise<CharacterWithChildren> {
  const nid = normalizeId(id);
  const c = isUuid(nid) ? await selectCharacter(nid) : null;
  if (c === null) throw fail(CHARACTER_ERROR_CODES.NOT_FOUND, `Character not found: ${id}`);
  return c;
}

function explain(outcome: WriteOutcome, id: string): never {
  if (outcome.outcome === "not_found") throw fail(CHARACTER_ERROR_CODES.NOT_FOUND, `Character not found: ${id}`);
  if (outcome.outcome === "stale") throw fail(CHARACTER_ERROR_CODES.STALE_WRITE, `This Character changed since it was loaded (now at version ${outcome.current}). Reload it and review before saving again.`);
  throw fail(CHARACTER_ERROR_CODES.CORE_FROZEN, "Core creation is complete: the Character's mechanical creation choices are frozen. Name and concept stay editable.");
}

// ---- Release capability -----------------------------------------------------------------------------------------------

/** Whether one exact Release can build a WO3 Character, with every missing requirement. Read-only. */
export async function getReleaseCharacterCreationCapability(releaseId: string): Promise<CharacterCreationCapability & { readonly release: CharacterReleaseSummary }> {
  const release = await releaseSummary(normalizeId(releaseId));
  const { bundle } = await releaseRules(release.id);
  return { ...getCharacterCreationCapability(bundle), release };
}

// ---- create / list / read -------------------------------------------------------------------------------------------

/**
 * Creates a Character Draft on one exact Release. Accepts only a name, an optional concept and the Release id: Level,
 * derived values and composition are never caller inputs. The Release must be integrity-verified and capable.
 */
export async function createCharacter(input: { readonly name: unknown; readonly concept?: unknown; readonly rulesetReleaseId: unknown }): Promise<CharacterDetail> {
  const name = readName(input.name);
  const concept = readConcept(input.concept);
  if (typeof input.rulesetReleaseId !== "string" || !isUuid(normalizeId(input.rulesetReleaseId))) throw fail(CHARACTER_ERROR_CODES.INVALID_INPUT, "rulesetReleaseId is the exact id of a published Release");
  const releaseId = normalizeId(input.rulesetReleaseId);
  await releaseSummary(releaseId);
  const verification = await verifyRulesetReleaseManifestHash(releaseId);
  if (!verification.valid) throw fail(CHARACTER_ERROR_CODES.RELEASE_INTEGRITY_FAILED, "This Release's manifest does not match its stored hash; no Character can be built from it");
  const { bundle } = await releaseRules(releaseId);
  const capability = getCharacterCreationCapability(bundle);
  const rule = characterCreationContent(bundle).creationRule;
  if (capability.status !== "READY" || rule === null) throw fail(CHARACTER_ERROR_CODES.RELEASE_NOT_CAPABLE, `This Release cannot build a Character: ${capability.missing.map((m) => m.requirement).join(", ")}`);
  const row = await insertCharacter({ name, concept, rulesetReleaseId: releaseId, level: rule.payload.startingLevel });
  return getCharacter(row.id);
}

export async function listCharacters(query: { readonly page: number; readonly pageSize: number }): Promise<{ items: CharacterListItem[]; total: number; page: number; pageSize: number }> {
  const [total, rows] = await Promise.all([countCharacters(), selectCharacterPage((query.page - 1) * query.pageSize, query.pageSize)]);
  return {
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      level: r.level,
      status: r.coreCreationCompletedAt === null ? "DRAFT" : "CORE_COMPLETE",
      updatedAt: r.updatedAt,
      release: { id: r.rulesetRelease.id, rulesetId: r.rulesetRelease.ruleset.id, rulesetName: r.rulesetRelease.ruleset.name, releaseNumber: r.rulesetRelease.releaseNumber, versionLabel: r.rulesetRelease.versionLabel, channel: String(r.rulesetRelease.channel) },
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

/** The Character as stored, resolved against ITS Release (validation, provenance, M5 / M4 derived preview). Read-only. */
export async function getCharacter(id: string): Promise<CharacterDetail> {
  const c = await requireCharacter(id);
  const release = await releaseSummary(c.rulesetReleaseId);
  const { bundle, ruleset } = await releaseRules(c.rulesetReleaseId);
  const choices = choicesOf(c);
  const resolution = validateCharacterCreation({ bundle, ruleset, candidate: candidateOf(choices) });
  const names = await namesOf([resolution.resolved.ancestry, resolution.resolved.primaryAffinity, resolution.resolved.creationRule, ...resolution.resolved.skills.map((s) => s.skill), ...(resolution.derivedPreview ?? []).map((d) => d.definition)]);
  return {
    id: c.id,
    name: c.name,
    concept: c.concept,
    level: c.level,
    lockVersion: c.lockVersion,
    coreCreationCompletedAt: c.coreCreationCompletedAt,
    status: c.coreCreationCompletedAt === null ? "DRAFT" : "CORE_COMPLETE",
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    release,
    choices,
    resolution,
    names,
  };
}

// ---- creation context --------------------------------------------------------------------------------------------------

export interface CreationOption {
  readonly ref: ProwessDefinitionRef;
  readonly displayName: string;
  readonly shortDescription: string | null;
  readonly revisionNumber: number;
  readonly payload: unknown;
  readonly schemaVersion?: number;
  readonly executable?: boolean;
}

export interface CharacterCreationContext {
  readonly character: { readonly id: string; readonly name: string; readonly lockVersion: number; readonly status: "DRAFT" | "CORE_COMPLETE" };
  readonly release: CharacterReleaseSummary;
  readonly capability: CharacterCreationCapability;
  readonly creationRule: CreationOption | null;
  readonly stats: ReadonlyArray<{ readonly stat: string; readonly minimum: number; readonly maximum: number; readonly ref: ProwessDefinitionRef }>;
  readonly characterDie: { readonly level: number; readonly dieKey: string; readonly faces: number } | null;
  readonly skillRankLadder: { readonly ref: ProwessDefinitionRef; readonly ranks: ReadonlyArray<{ readonly rankKey: string; readonly order: number }> } | null;
  readonly derivedStatistics: ReadonlyArray<{ readonly statistic: string; readonly ref: ProwessDefinitionRef; readonly required: boolean }>;
  readonly ancestries: readonly CreationOption[];
  readonly skills: readonly CreationOption[];
  readonly affinities: readonly CreationOption[];
}

/**
 * Everything the creation wizard needs, from the Character's exact Release, in one normalized read: the creation rule,
 * Stat bounds, Character Die, Skill rank ladder, Derived Stats and the selectable Ancestries, Skills and Affinities —
 * each with its exact reference. The browser never assembles game rules itself.
 */
export async function getCharacterCreationContext(id: string): Promise<CharacterCreationContext> {
  const c = await requireCharacter(id);
  const release = await releaseSummary(c.rulesetReleaseId);
  const { bundle, ruleset } = await releaseRules(c.rulesetReleaseId);
  const content = characterCreationContent(bundle);
  const capability = getCharacterCreationCapability(bundle);
  const display = new Map((await selectVersionDisplay(bundle.definitions.filter((d) => ["ANCESTRY", "SKILL", "AFFINITY", "CHARACTER_CREATION_RULE"].includes(d.definitionKind)).map((d) => d.entityVersionId))).map((v) => [v.id, v] as const));
  const option = (ref: ProwessDefinitionRef, payload: unknown, extra: Partial<CreationOption> = {}): CreationOption => {
    const v = display.get(ref.entityVersionId);
    return { ref, displayName: v?.displayName ?? ref.canonicalKey, shortDescription: v?.shortDescription ?? null, revisionNumber: v?.revisionNumber ?? 0, payload, ...extra };
  };
  const byName = (a: CreationOption, b: CreationOption) => a.displayName.localeCompare(b.displayName) || (a.ref.canonicalKey < b.ref.canonicalKey ? -1 : 1);
  const core = content.core;
  const preview = validateCharacterCreation({ bundle, ruleset, candidate: { ancestry: null, ancestryStatChoices: [], statAllocations: {}, skills: [], primaryAffinity: null } });
  return {
    character: { id: c.id, name: c.name, lockVersion: c.lockVersion, status: c.coreCreationCompletedAt === null ? "DRAFT" : "CORE_COMPLETE" },
    release,
    capability,
    creationRule: content.creationRule === null ? null : option(content.creationRule.ref, content.creationRule.payload),
    stats: core === null ? [] : Object.values(core.stats).map((s) => ({ stat: s.payload.stat, minimum: s.payload.minimum, maximum: s.payload.maximum, ref: s.ref })),
    characterDie: preview.resolved.characterDie === null || preview.resolved.level === null ? null : { level: preview.resolved.level, ...preview.resolved.characterDie },
    skillRankLadder: core === null ? null : { ref: core.skillLadder.ref, ranks: core.skillLadder.payload.ranks.map((r) => ({ rankKey: r.rankKey, order: r.order })) },
    derivedStatistics: core === null ? [] : core.derivedOrder.map((statistic) => ({ statistic, ref: core.derived[statistic]!.ref, required: (CHARACTER_CREATION_REQUIRED_DERIVED_STATISTICS as readonly string[]).includes(statistic) })),
    ancestries: content.ancestries.map((a) => option(a.ref, a.payload)).sort(byName),
    skills: content.skills.map((s) => option(s.ref, s.payload)).sort(byName),
    affinities: content.affinities.map((a) => option(a.ref, bundle.definitions.find((d) => d.entityVersionId === a.ref.entityVersionId)?.payload ?? null, { schemaVersion: a.schemaVersion, executable: a.executable })).sort(byName),
  };
}

// ---- validate / save / profile / finalize ----------------------------------------------------------------------------

function readCandidate(value: unknown): CharacterCreationCandidate {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw fail(CHARACTER_ERROR_CODES.INVALID_INPUT, "the creation candidate is an object");
  const v = value as Record<string, unknown>;
  const allowed = ["ancestry", "ancestryStatChoices", "statAllocations", "skills", "primaryAffinity"];
  for (const k of Object.keys(v)) if (!allowed.includes(k)) throw fail(CHARACTER_ERROR_CODES.INVALID_INPUT, `${k} is not a creation input (Level, ranks and derived values are decided by the server)`);
  return {
    ancestry: (v.ancestry ?? null) as CharacterCreationCandidate["ancestry"],
    ancestryStatChoices: (v.ancestryStatChoices ?? []) as CharacterCreationCandidate["ancestryStatChoices"],
    statAllocations: (v.statAllocations ?? {}) as CharacterCreationCandidate["statAllocations"],
    skills: (v.skills ?? []) as CharacterCreationCandidate["skills"],
    primaryAffinity: (v.primaryAffinity ?? null) as CharacterCreationCandidate["primaryAffinity"],
  };
}

/** Side-effect-free check of an UNSAVED candidate against the Character's Release (§67). Writes nothing. */
export async function validateCharacterCandidate(id: string, candidate: unknown): Promise<CharacterCreationResult> {
  const c = await requireCharacter(id);
  const { bundle, ruleset } = await releaseRules(c.rulesetReleaseId);
  return validateCharacterCreation({ bundle, ruleset, candidate: readCandidate(candidate) });
}

/**
 * Save & Continue (§66, §73): validates the candidate against the Character's Release, refuses any ERROR, then writes
 * the exact choices and the Release-decided Skill ranks atomically at the expected lockVersion. INCOMPLETE is allowed
 * (it is a Draft). The Release, Level and derived values are never written here.
 */
export async function saveCharacterCreation(id: string, input: { readonly expectedLockVersion: unknown; readonly candidate: unknown }): Promise<CharacterDetail> {
  const expected = readExpectedLockVersion(input.expectedLockVersion);
  const c = await requireCharacter(id);
  if (c.coreCreationCompletedAt !== null) explain({ outcome: "frozen" }, id);
  const { bundle, ruleset } = await releaseRules(c.rulesetReleaseId);
  const result = validateCharacterCreation({ bundle, ruleset, candidate: readCandidate(input.candidate) });
  if (result.status === "INVALID") {
    const first = result.issues.filter((i) => i.severity === "ERROR").slice(0, 3).map((i) => `${i.path || "Character"}: ${i.message}`).join("; ");
    throw fail(CHARACTER_ERROR_CODES.INVALID_CREATION, `These creation choices are not legal for this Release — ${first}`);
  }
  const r = result.resolved;
  const outcome = await replaceCreationInputs(c.id, expected, {
    ancestry: r.ancestry === null ? null : { entityId: r.ancestry.entityId, entityVersionId: r.ancestry.entityVersionId },
    primaryAffinity: r.primaryAffinity === null ? null : { entityId: r.primaryAffinity.entityId, entityVersionId: r.primaryAffinity.entityVersionId },
    statAllocations: r.stats.filter((s) => s.allocated > 0).map((s) => ({ stat: s.stat, pointsSpent: s.allocated })),
    ancestryStatChoices: readCandidate(input.candidate).ancestryStatChoices.map((x) => ({ grantKey: x.grantKey, stat: x.stat })),
    skillRanks: r.skills.map((s) => ({ skillEntityId: s.skill.entityId, skillEntityVersionId: s.skill.entityVersionId, rankKey: s.rankKey, sourceKind: s.sourceKind, sourceGrantKey: s.sourceGrantKey })),
  });
  if (outcome.outcome !== "ok") explain(outcome, id);
  return getCharacter(c.id);
}

/** Profile edit (§39): name and concept only, in any state, at the expected lockVersion. */
export async function updateCharacterProfile(id: string, input: { readonly expectedLockVersion: unknown; readonly name: unknown; readonly concept?: unknown }): Promise<CharacterDetail> {
  const expected = readExpectedLockVersion(input.expectedLockVersion);
  const c = await requireCharacter(id);
  const outcome = await updateProfile(c.id, expected, { name: readName(input.name), concept: readConcept(input.concept) });
  if (outcome.outcome !== "ok") explain(outcome, id);
  return getCharacter(c.id);
}

/**
 * Complete Core Creation (§7, §37, §68): the Release manifest must pass M2 verification, the STORED choices must be a
 * complete, valid build for that Release, and the completion is recorded at exactly the expected lockVersion. No game
 * choice is changed. Afterwards the mechanical creation inputs are frozen (service and database guard).
 */
export async function finalizeCharacterCoreCreation(id: string, input: { readonly expectedLockVersion: unknown }): Promise<CharacterDetail> {
  const expected = readExpectedLockVersion(input.expectedLockVersion);
  const c = await requireCharacter(id);
  if (c.coreCreationCompletedAt !== null) explain({ outcome: "frozen" }, id);
  const verification = await verifyRulesetReleaseManifestHash(c.rulesetReleaseId);
  if (!verification.valid) throw fail(CHARACTER_ERROR_CODES.RELEASE_INTEGRITY_FAILED, "This Character's Release failed manifest verification; core creation cannot be completed");
  if (c.lockVersion !== expected) explain({ outcome: "stale", current: c.lockVersion }, id);
  const { bundle, ruleset } = await releaseRules(c.rulesetReleaseId);
  const result = validateCharacterCreation({ bundle, ruleset, candidate: candidateOf(choicesOf(c)) });
  if (result.status !== "READY") {
    const first = result.issues.slice(0, 3).map((i) => `${i.path || "Character"}: ${i.message}`).join("; ");
    throw fail(CHARACTER_ERROR_CODES.CREATION_INCOMPLETE, `Core creation is not complete — ${first}`);
  }
  const outcome = await markCoreCreationComplete(c.id, expected, new Date());
  if (outcome.outcome !== "ok") explain(outcome, id);
  return getCharacter(c.id);
}
