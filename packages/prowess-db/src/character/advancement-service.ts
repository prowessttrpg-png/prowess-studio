import { CHARACTER_ERROR_CODES } from "@prowess/model";
import {
  PROWESS_DEFINITION_KINDS,
  characterAccessSummary,
  evaluateComponentEligibility,
  getCharacterCapability,
  listComponentEligibility,
  previewCharacterAdvancement,
  type AccessSummary,
  type AdvancementPreview,
  type CharacterCapability,
  type CharacterMechanicalProfile,
  type ComponentEligibility,
  type ProwessDefinitionKind,
  type ProwessDefinitionRef,
} from "@prowess/game";
import { verifyRulesetReleaseManifestHash } from "../ruleset-release/service.js";
import { commitAdvancement } from "./advancement-repository.js";
import { profileOf, progressionOf } from "./progression.js";
import { selectVersionDisplay } from "./repository.js";
import {
  candidateOf,
  choicesOf,
  explain,
  fail,
  getCharacter,
  historyEntriesOf,
  namesOf,
  readExpectedLockVersion,
  releaseRules,
  releaseSummary,
  requireCharacterSnapshot,
  type CharacterAdvancementHistoryEntry,
  type CharacterDetail,
  type CharacterReleaseSummary,
} from "./service.js";

/**
 * Character advancement & access service (PAS-10 M6-WO4). Orchestration and persistence only:
 *
 *   load the Character → its EXACT Release (integrity-verified materialization) → creation + committed history →
 *   @prowess/game rebuilds the profile / validates the next Level / evaluates eligibility → commit ONE Level atomically
 *
 * Nothing here computes a Stat, a rank, a die, a derived value or an access verdict; no Level, rank or derived value is
 * ever a caller input. The Character's Release never changes and is never looked up by Ruleset or "latest".
 */

const MAX_PAGE_SIZE = 100;

async function loadCompleted(id: string) {
  const { c, history } = await requireCharacterSnapshot(id);
  if (c.coreCreationCompletedAt === null) throw fail(CHARACTER_ERROR_CODES.CORE_CREATION_INCOMPLETE, "Only a Character whose core creation is complete can advance or report access");
  const { bundle, ruleset } = await releaseRules(c.rulesetReleaseId);
  const progression = progressionOf(candidateOf(choicesOf(c)), c.level, history);
  return { c, bundle, ruleset, history, progression };
}

function requireProfile(built: ReturnType<typeof profileOf>): CharacterMechanicalProfile {
  if (built.profile === null) throw fail(CHARACTER_ERROR_CODES.ADVANCEMENT_NOT_CAPABLE, `This Character's Release cannot rebuild its profile: ${built.issues.map((i) => i.message).join("; ")}`);
  return built.profile;
}

export interface AdvancementOption {
  readonly ref: ProwessDefinitionRef;
  readonly displayName: string;
  readonly rankKey: string | null;
}

export interface CharacterAdvancementContext {
  readonly character: { readonly id: string; readonly name: string; readonly level: number; readonly lockVersion: number };
  readonly release: CharacterReleaseSummary;
  readonly capability: CharacterCapability;
  readonly profile: CharacterMechanicalProfile;
  /** Null at the maximum Level. */
  readonly next: AdvancementPreview["entitlements"];
  readonly maximumLevelReached: boolean;
  /** Skills the Character may TRAIN_NEW (pinned, not owned) and UPGRADE (owned, below the ladder's top rank). */
  readonly skillOptions: { readonly trainNew: readonly AdvancementOption[]; readonly upgrade: readonly AdvancementOption[] };
  /** Executable Affinities a GAIN option could name (not owned) and the owned ones a RANK_UP could name. */
  readonly affinityOptions: { readonly gain: readonly AdvancementOption[]; readonly owned: readonly AdvancementOption[] };
  readonly history: readonly CharacterAdvancementHistoryEntry[];
  readonly names: Readonly<Record<string, string>>;
}

/**
 * Everything the advancement flow needs in ONE read (§79): the present profile, the next Level's entitlements from the
 * exact Release, the selectable Skill / Affinity targets (exact references) and the history. Read-only.
 */
export async function getCharacterAdvancementContext(id: string): Promise<CharacterAdvancementContext> {
  const { c, bundle, ruleset, history, progression } = await loadCompleted(id);
  const release = await releaseSummary(c.rulesetReleaseId);
  const capability = getCharacterCapability(bundle);
  const profile = requireProfile(profileOf(bundle, ruleset, progression));
  const empty = previewCharacterAdvancement({ bundle, ruleset, character: progression, choices: { statAllocations: {}, skillAdvancements: [], affinityChoice: null } });
  const display = new Map((await selectVersionDisplay(bundle.definitions.filter((d) => d.definitionKind === "SKILL" || d.definitionKind === "AFFINITY").map((d) => d.entityVersionId))).map((v) => [v.id, v.displayName] as const));
  const label = (ref: ProwessDefinitionRef) => display.get(ref.entityVersionId) ?? ref.canonicalKey;
  const ladder = bundle.definitions.find((d) => d.definitionKind === "RANK_LADDER" && (d.payload as { ladderKey?: string }).ladderKey === "SKILL");
  const ranks = ((ladder?.payload as { ranks?: { rankKey: string; order: number }[] } | undefined)?.ranks ?? []).map((r) => r.rankKey);
  const top = ranks.at(-1) ?? null;
  const refOf = (d: (typeof bundle.definitions)[number]): ProwessDefinitionRef => ({ entityId: d.entityId, entityVersionId: d.entityVersionId, canonicalKey: d.canonicalKey, definitionKind: d.definitionKind, systemFamily: d.systemFamily }) as ProwessDefinitionRef;
  const byName = (a: AdvancementOption, b: AdvancementOption) => a.displayName.localeCompare(b.displayName) || (a.ref.canonicalKey < b.ref.canonicalKey ? -1 : 1);
  const skills = bundle.definitions.filter((d) => d.definitionKind === "SKILL");
  const owned = new Map(profile.skills.map((s) => [s.skill.entityId, s] as const));
  const trainNew = skills.filter((d) => !owned.has(d.entityId)).map((d) => ({ ref: refOf(d), displayName: label(refOf(d)), rankKey: null }));
  const upgrade = profile.skills.filter((s) => s.rankKey !== top).map((s) => ({ ref: s.skill, displayName: label(s.skill), rankKey: s.rankKey }));
  const ownedAffinities = new Set(profile.affinities.map((a) => a.affinity.entityId));
  const gain = bundle.definitions.filter((d) => d.definitionKind === "AFFINITY" && d.schemaVersion === 2 && !ownedAffinities.has(d.entityId)).map((d) => ({ ref: refOf(d), displayName: label(refOf(d)), rankKey: null }));
  const ownedOptions = profile.affinities.map((a) => ({ ref: a.affinity, displayName: label(a.affinity), rankKey: a.rank }));
  const names = await namesOf([...profile.skills.map((s) => s.skill), ...profile.affinities.map((a) => a.affinity), ...history.flatMap((h) => h.skillAdvancements.map((s) => ({ entityVersionId: s.skillEntityVersionId }) as ProwessDefinitionRef)), ...history.flatMap((h) => (h.affinityChoice?.affinityEntityVersionId ? [{ entityVersionId: h.affinityChoice.affinityEntityVersionId } as ProwessDefinitionRef] : []))]);
  return {
    character: { id: c.id, name: c.name, level: c.level, lockVersion: c.lockVersion },
    release,
    capability,
    profile,
    next: empty.entitlements,
    maximumLevelReached: empty.status === "MAX_LEVEL",
    skillOptions: { trainNew: trainNew.sort(byName), upgrade: upgrade.sort(byName) },
    affinityOptions: { gain: gain.sort(byName), owned: ownedOptions },
    history: historyEntriesOf(history),
    names,
  };
}

/** Side-effect-free preview of advancing ONE Level with `choices` (§39). */
export async function previewCharacterAdvancementFor(id: string, choices: unknown): Promise<AdvancementPreview> {
  const { bundle, ruleset, progression } = await loadCompleted(id);
  return previewCharacterAdvancement({ bundle, ruleset, character: progression, choices });
}

/**
 * Advance Character (§42): verify the exact Release's manifest, rebuild and validate against it, then commit exactly ONE
 * Level — advancement row, Stat / Skill / Affinity choice rows, Level and lockVersion — in one transaction at the
 * expected version. The client never supplies the Level, a rank, a die or a derived value.
 */
export async function advanceCharacter(id: string, input: { readonly expectedLockVersion: unknown; readonly choices: unknown }): Promise<CharacterDetail> {
  const expected = readExpectedLockVersion(input.expectedLockVersion);
  const { c, bundle, ruleset, progression } = await loadCompleted(id);
  if (c.lockVersion !== expected) explain({ outcome: "stale", current: c.lockVersion }, id);
  const verification = await verifyRulesetReleaseManifestHash(c.rulesetReleaseId);
  if (!verification.valid) throw fail(CHARACTER_ERROR_CODES.RELEASE_INTEGRITY_FAILED, "This Character's Release failed manifest verification; it cannot advance");
  const preview = previewCharacterAdvancement({ bundle, ruleset, character: progression, choices: input.choices });
  const summary = (codes: readonly { path: string; message: string }[]) => codes.slice(0, 3).map((i) => `${i.path || "Character"}: ${i.message}`).join("; ");
  if (preview.status === "MAX_LEVEL") throw fail(CHARACTER_ERROR_CODES.MAX_LEVEL, `Maximum Level reached: Level ${c.level} is the highest Level of this Character's Release`);
  if (preview.status === "INVALID") {
    if (preview.issues.some((i) => i.code === "PROWESS_ADVANCEMENT.MISSING_ADVANCEMENT_CONTENT")) throw fail(CHARACTER_ERROR_CODES.ADVANCEMENT_NOT_CAPABLE, `This Character's Release cannot advance Characters — ${summary(preview.issues)}`);
    throw fail(CHARACTER_ERROR_CODES.INVALID_ADVANCEMENT, `These advancement choices are not legal for this Release — ${summary(preview.issues.filter((i) => i.severity === "ERROR"))}`);
  }
  if (preview.status !== "READY" || preview.record === null || preview.fromLevel === null) throw fail(CHARACTER_ERROR_CODES.ADVANCEMENT_INCOMPLETE, `The advancement is not complete — ${summary(preview.issues)}`);
  const record = preview.record;
  const outcome = await commitAdvancement(c.id, expected, {
    fromLevel: preview.fromLevel,
    toLevel: record.toLevel,
    statAllocations: Object.entries(record.statAllocations).map(([stat, points]) => ({ stat, pointsSpent: points as number })),
    skillAdvancements: record.skillAdvancements.map((s) => ({ skillEntityId: s.skill.entityId, skillEntityVersionId: s.skill.entityVersionId, action: s.action })),
    affinityChoice: record.affinityChoice === null ? null : { optionKey: record.affinityChoice.optionKey, affinityEntityId: record.affinityChoice.affinity?.entityId ?? null, affinityEntityVersionId: record.affinityChoice.affinity?.entityVersionId ?? null },
  });
  if (outcome.outcome !== "ok") explain(outcome, id);
  return getCharacter(c.id);
}

export interface CharacterAccess {
  readonly character: { readonly id: string; readonly level: number };
  readonly release: CharacterReleaseSummary;
  readonly summary: AccessSummary;
}

/** The Character's construction access summary (§56–§58), from its present profile and exact Release. Read-only. */
export async function getCharacterAccess(id: string): Promise<CharacterAccess> {
  const { c, bundle, ruleset, progression } = await loadCompleted(id);
  const profile = requireProfile(profileOf(bundle, ruleset, progression));
  return { character: { id: c.id, level: c.level }, release: await releaseSummary(c.rulesetReleaseId), summary: characterAccessSummary({ bundle, profile }) };
}

/**
 * Eligibility of the Release's Definitions of ONE kind for this Character (§65), bounded and paginated. The Character's
 * facts are built once per request. `includeLocked` adds INELIGIBLE / UNRESOLVED entries with their reasons.
 */
export async function listCharacterEligibleDefinitions(
  id: string,
  query: { readonly definitionKind: unknown; readonly includeLocked?: boolean; readonly page: number; readonly pageSize: number },
): Promise<{ items: (ComponentEligibility & { displayName: string })[]; total: number; page: number; pageSize: number }> {
  if (typeof query.definitionKind !== "string" || !Object.hasOwn(PROWESS_DEFINITION_KINDS, query.definitionKind)) throw fail(CHARACTER_ERROR_CODES.INVALID_INPUT, "definitionKind is a Prowess Definition kind");
  if (!(query.pageSize >= 1 && query.pageSize <= MAX_PAGE_SIZE)) throw fail(CHARACTER_ERROR_CODES.INVALID_INPUT, `pageSize is 1–${MAX_PAGE_SIZE}`);
  const { bundle, ruleset, progression } = await loadCompleted(id);
  const profile = requireProfile(profileOf(bundle, ruleset, progression));
  const all = listComponentEligibility({ bundle, profile, definitionKind: query.definitionKind as ProwessDefinitionKind }).filter((e) => query.includeLocked === true || e.status === "ELIGIBLE");
  const page = all.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
  const display = new Map((await selectVersionDisplay(page.flatMap((e) => (e.definition === null ? [] : [e.definition.entityVersionId])))).map((v) => [v.id, v.displayName] as const));
  return { items: page.map((e) => ({ ...e, displayName: e.definition === null ? "" : (display.get(e.definition.entityVersionId) ?? e.definition.canonicalKey) })), total: all.length, page: query.page, pageSize: query.pageSize };
}

/** Eligibility of ONE exact Definition for this Character (exact pin of its Release). */
export async function getCharacterDefinitionEligibility(id: string, definition: { readonly entityId: unknown; readonly entityVersionId: unknown }): Promise<ComponentEligibility> {
  if (typeof definition.entityId !== "string" || typeof definition.entityVersionId !== "string") throw fail(CHARACTER_ERROR_CODES.INVALID_INPUT, "a Definition is named by its exact entityId and entityVersionId");
  const { bundle, ruleset, progression } = await loadCompleted(id);
  const profile = requireProfile(profileOf(bundle, ruleset, progression));
  return evaluateComponentEligibility({ bundle, profile, definition: { entityId: definition.entityId, entityVersionId: definition.entityVersionId } });
}
