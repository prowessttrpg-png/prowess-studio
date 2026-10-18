import { deepFreeze } from "../internal/plain-data.js";
import { Problems, checkPlainData, finish, isExactCanonicalKey, isToken, own, readEnum, readRecord, readSafeInteger, type ProwessOutcome } from "../internal/problems.js";
import { AFFINITY_ERROR_CODES as A, DEFINITION_ERROR_CODES as C } from "../definition/codes.js";
import { readDefinitionRef, type ProwessDefinitionRef } from "../definition/envelope.js";
import { findBundleDefinition, type ProwessDefinitionBundle } from "../bundle/bundle.js";
import type { AffinityAdvancementOption } from "../definition/affinity-payload.js";
import { AFFINITY_RANKS, AFFINITY_ROLES, type AffinityRank, type AffinityRole } from "../vocabulary/affinity.js";
import type { CanonicalAffinity } from "../vocabulary/construction.js";
import { findAffinityEntry, indexAffinityDefinitions, type AffinityDefinitionIndex } from "./definitions.js";

/**
 * The character's Affinities (PAS-10 M5-WO4 §39–§52). Ownership and Rank are separate facts (M5-I116): an owned
 * Affinity at rank NONE is owned, with no trained benefit (§41). Every owned Affinity is an exact executable AFFINITY
 * Definition of the profile's exact Ruleset bundle (§137–§139) — no display name, no canonical-key-only lookup, no
 * second version of the same Entity (§138). The profile is detached plain data: later mutation of the caller's input
 * never changes a validated profile or a past evaluation (§161).
 */
export interface OwnedAffinity {
  readonly affinity: ProwessDefinitionRef;
  /** The canonical identity the exact Definition declares — read from content, never from the ref's key text. */
  readonly identity: CanonicalAffinity;
  readonly rank: AffinityRank;
  readonly role: AffinityRole;
  /** How it was acquired, when recorded: the Level and the progression option (or an explicit override key). */
  readonly acquisition: { readonly level: number; readonly optionKey: string } | null;
}

export interface CharacterAffinityProfile {
  readonly primaryAffinity: ProwessDefinitionRef;
  /** PRIMARY first, then by canonical key — never by input order. */
  readonly affinities: readonly OwnedAffinity[];
}

const ENTRY_FIELDS = ["affinity", "rank", "role", "acquisition"];
/** Input validation only: Character Levels start at 1. Never a progression rule (those are AFFINITY_PROGRESSION content). */
const FIRST_CHARACTER_LEVEL = 1;

/** Validates a CharacterAffinityProfile against the exact bundle. Identical duplicates collapse; conflicting ones fail closed. */
export function validateAffinityProfile(value: unknown, bundle: ProwessDefinitionBundle, index?: AffinityDefinitionIndex): ProwessOutcome<CharacterAffinityProfile> {
  const p = new Problems();
  if (!checkPlainData(value, [], p, C.NOT_PLAIN_DATA)) return finish(p, () => null as never);
  const resolved = index ?? (() => {
    const out = indexAffinityDefinitions(bundle);
    if (!out.ok) {
      p.list.push(...out.problems);
      return null;
    }
    return out.value;
  })();
  const r = readRecord(value, [], p, A.INVALID_AFFINITY_PROFILE, ["affinities"], ["affinities"]);
  if (r === null || resolved === null) return finish(p, () => null as never);
  const raw = own(r, "affinities");
  if (!Array.isArray(raw) || raw.length === 0) {
    p.add(A.INVALID_AFFINITY_PROFILE, ["affinities"], "affinities is a non-empty array of owned Affinities (a standard character owns its Primary from Level 1)");
    return finish(p, () => null as never);
  }
  const owned: OwnedAffinity[] = [];
  raw.forEach((item: unknown, i: number) => {
    const at = ["affinities", i];
    const e = readRecord(item, at, p, A.INVALID_AFFINITY_PROFILE, ENTRY_FIELDS, ENTRY_FIELDS);
    if (e === null) return;
    const before = p.count;
    const ref = readDefinitionRef(own(e, "affinity"), [...at, "affinity"], p, A.INVALID_AFFINITY_PROFILE);
    const rank = readEnum(own(e, "rank"), AFFINITY_RANKS, [...at, "rank"], p, A.INVALID_AFFINITY_PROFILE, "Affinity Rank");
    const role = readEnum(own(e, "role"), AFFINITY_ROLES, [...at, "role"], p, A.INVALID_AFFINITY_PROFILE, "Affinity role");
    const rawAcquisition = own(e, "acquisition");
    let acquisition: OwnedAffinity["acquisition"] = null;
    if (rawAcquisition !== null) {
      const a = readRecord(rawAcquisition, [...at, "acquisition"], p, A.INVALID_AFFINITY_PROFILE, ["level", "optionKey"], ["level", "optionKey"]);
      const level = a === null ? null : readSafeInteger(own(a, "level"), [...at, "acquisition", "level"], p, A.INVALID_AFFINITY_PROFILE, "level");
      const optionKey = a === null ? null : own(a, "optionKey");
      if (a !== null && !isToken(optionKey)) p.add(A.INVALID_AFFINITY_PROFILE, [...at, "acquisition", "optionKey"], "optionKey is a SCREAMING_SNAKE token");
      if (level !== null && !(level >= FIRST_CHARACTER_LEVEL)) p.add(A.INVALID_AFFINITY_PROFILE, [...at, "acquisition", "level"], "a Character Level is at least 1");
      if (level !== null && isToken(optionKey)) acquisition = { level, optionKey };
    }
    if (ref === null || rank === null || role === null || p.count > before) return;
    if (ref.definitionKind !== "AFFINITY" || findBundleDefinition(bundle, ref) === null) {
      p.add(A.AFFINITY_NOT_IN_RULESET, [...at, "affinity"], "an owned Affinity is an exact AFFINITY Definition pinned by this Ruleset");
      return;
    }
    const entry = findAffinityEntry(resolved, ref);
    if (entry === null) {
      p.add(A.AFFINITY_NOT_EXECUTABLE, [...at, "affinity"], "an owned Affinity must be an executable (payload version 2) AFFINITY Definition");
      return;
    }
    const candidate: OwnedAffinity = { affinity: { ...ref }, identity: entry.affinity, rank, role, acquisition };
    const same = owned.find((o) => o.affinity.entityId === ref.entityId);
    if (same !== undefined) {
      if (same.affinity.entityVersionId !== ref.entityVersionId) p.add(A.AFFINITY_NOT_IN_RULESET, [...at, "affinity"], "two versions of one Affinity Entity are never mixed in one profile");
      else if (JSON.stringify(same) !== JSON.stringify(candidate)) p.add(A.DUPLICATE_AFFINITY_OWNERSHIP, at, `${ref.canonicalKey} is owned twice with conflicting rank / role / acquisition; no value is silently chosen`);
      return; // an identical duplicate collapses deterministically
    }
    owned.push(candidate);
  });
  const primaries = owned.filter((o) => o.role === "PRIMARY");
  if (p.count === 0 && primaries.length !== 1) p.add(A.INVALID_AFFINITY_PROFILE, ["affinities"], "a profile has exactly one PRIMARY Affinity");
  const ordered = [...owned].sort((a, b) => (a.role !== b.role ? (a.role === "PRIMARY" ? -1 : 1) : a.affinity.canonicalKey < b.affinity.canonicalKey ? -1 : a.affinity.canonicalKey > b.affinity.canonicalKey ? 1 : 0));
  return finish(p, () => deepFreeze({ primaryAffinity: (primaries[0] as OwnedAffinity).affinity, affinities: ordered }));
}

/** The character's exact owned entry for `ref`, or null (exact version equality — §139). */
export function ownedAffinity(profile: CharacterAffinityProfile, ref: ProwessDefinitionRef): OwnedAffinity | null {
  return profile.affinities.find((o) => o.affinity.entityId === ref.entityId && o.affinity.entityVersionId === ref.entityVersionId && o.affinity.canonicalKey === ref.canonicalKey) ?? null;
}

// ---- standard progression validation (§157–§160) --------------------------------------------------------------------

/** VALID: some authored progression path reaches the profile. REQUIRES_CANON: only a path through an unresolved option does. */
export type AffinityProgressionStatus = "VALID" | "INVALID" | "REQUIRES_CANON";

export interface AffinityProgressionResult {
  readonly status: AffinityProgressionStatus;
  readonly characterLevel: number;
  /** The first authored path (Level → optionKey) that reaches the profile, when one does. */
  readonly path: readonly { readonly level: number; readonly optionKey: string }[] | null;
  /** Open source conflicts a REQUIRES_CANON path passes through (M5-SC-035). */
  readonly unresolvedConflicts: readonly string[];
  /** Profile entries accepted by an explicit, provenance-backed override instead of standard progression (§159). */
  readonly overridden: readonly { readonly overrideKey: string; readonly affinity: ProwessDefinitionRef; readonly rank: AffinityRank; readonly sourceKey: string }[];
  /** The options the next authored Level offers, exposed structurally (an unresolved option is never auto-executed). */
  readonly nextOptions: { readonly level: number; readonly options: readonly AffinityAdvancementOption[] } | null;
}

interface Slot {
  readonly role: AffinityRole;
  readonly rank: AffinityRank | null;
}
interface PathState {
  readonly slots: readonly Slot[];
  readonly path: readonly { readonly level: number; readonly optionKey: string }[];
  readonly conflicts: readonly string[];
}

const slotKey = (s: Slot) => `${s.role}:${s.rank ?? "?"}`;
const stateKey = (s: PathState) => s.slots.map(slotKey).sort().join("|");

function applyOption(state: PathState, option: AffinityAdvancementOption, level: number): PathState[] {
  const step = [...state.path, { level, optionKey: option.optionKey }];
  switch (option.action) {
    case "CHOOSE_PRIMARY_AFFINITY":
      return state.slots.some((s) => s.role === "PRIMARY") ? [] : [{ slots: [...state.slots, { role: "PRIMARY", rank: option.startingRank }], path: step, conflicts: state.conflicts }];
    case "RANK_UP": {
      const out: PathState[] = [];
      state.slots.forEach((s, i) => {
        if (s.rank !== option.from || (option.target === "PRIMARY" && s.role !== "PRIMARY")) return;
        out.push({ slots: state.slots.map((x, j) => (j === i ? { role: x.role, rank: option.to } : x)), path: step, conflicts: state.conflicts });
      });
      return out;
    }
    case "GAIN_AFFINITY":
      return [{ slots: [...state.slots, { role: option.role, rank: option.startingRank }], path: step, conflicts: option.conflictKey === null ? state.conflicts : [...state.conflicts, option.conflictKey] }];
  }
}

/** Whether `wanted` (the profile's role / rank slots) is exactly `state`, an unresolved (null) rank matching any rank. */
function matches(state: PathState, wanted: readonly Slot[]): boolean {
  const remaining = [...wanted];
  const wildcards: Slot[] = [];
  for (const s of state.slots) {
    if (s.rank === null) {
      wildcards.push(s);
      continue;
    }
    const at = remaining.findIndex((w) => w.role === s.role && w.rank === s.rank);
    if (at === -1) return false;
    remaining.splice(at, 1);
  }
  for (const w of wildcards) {
    const at = remaining.findIndex((x) => x.role === w.role);
    if (at === -1) return false;
    remaining.splice(at, 1);
  }
  return remaining.length === 0;
}

/**
 * Validates a profile against the exact AFFINITY_PROGRESSION Definition at a Character Level (§157–§160). The authored
 * Levels are applied in order, every option of a CHOOSE_ONE Level branching; the profile is VALID when some path
 * reaches exactly its (role, rank) slots. Progression is never inferred from the Level alone (§52): this only checks
 * that the explicit profile is REACHABLE. An unresolved starting rank (M5-SC-035) matches structurally but yields
 * REQUIRES_CANON — it is never guessed (§49). Overrides remove named entries from the standard check, explicitly.
 */
export function validateAffinityProgression(input: { readonly definitions: ProwessDefinitionBundle; readonly profile: unknown; readonly characterLevel: unknown; readonly overrides?: unknown }): ProwessOutcome<AffinityProgressionResult> {
  const p = new Problems();
  const index = indexAffinityDefinitions(input.definitions);
  if (!index.ok) return index as ProwessOutcome<never>;
  const progression = index.value.progression;
  if (progression === null) {
    p.add(A.MISSING_AFFINITY_DEFINITION, ["definitions"], "the bundle has no AFFINITY_PROGRESSION Definition");
    return finish(p, () => null as never);
  }
  const profile = validateAffinityProfile(input.profile, input.definitions, index.value);
  if (!profile.ok) {
    for (const problem of profile.problems) p.list.push({ ...problem, path: `/profile${problem.path}` });
    return finish(p, () => null as never);
  }
  const level = input.characterLevel;
  if (typeof level !== "number" || !Number.isSafeInteger(level) || !(level >= FIRST_CHARACTER_LEVEL)) {
    p.add(A.INVALID_PROGRESSION_REQUEST, ["characterLevel"], "characterLevel is an integer of at least 1");
    return finish(p, () => null as never);
  }
  const overridden: AffinityProgressionResult["overridden"][number][] = [];
  if (input.overrides !== undefined) {
    if (!checkPlainData(input.overrides, ["overrides"], p, C.NOT_PLAIN_DATA)) return finish(p, () => null as never);
    if (!Array.isArray(input.overrides)) p.add(A.INVALID_PROGRESSION_REQUEST, ["overrides"], "overrides is an array of { overrideKey, affinity, rank, sourceKey }");
    else
      input.overrides.forEach((raw: unknown, i: number) => {
        const fields = ["overrideKey", "affinity", "rank", "sourceKey"];
        const o = readRecord(raw, ["overrides", i], p, A.INVALID_PROGRESSION_REQUEST, fields, fields);
        if (o === null) return;
        const overrideKey = own(o, "overrideKey");
        const sourceKey = own(o, "sourceKey");
        const ref = readDefinitionRef(own(o, "affinity"), ["overrides", i, "affinity"], p, A.INVALID_PROGRESSION_REQUEST);
        const rank = readEnum(own(o, "rank"), AFFINITY_RANKS, ["overrides", i, "rank"], p, A.INVALID_PROGRESSION_REQUEST, "Affinity Rank");
        if (!isToken(overrideKey)) p.add(A.INVALID_PROGRESSION_REQUEST, ["overrides", i, "overrideKey"], "overrideKey is a SCREAMING_SNAKE token");
        // An override is provenance-backed: it names the exact canonical key of the feature that grants it (§159).
        if (!isExactCanonicalKey(sourceKey)) p.add(A.INVALID_PROGRESSION_REQUEST, ["overrides", i, "sourceKey"], "sourceKey is the exact canonical key of the rule granting the override");
        if (ref === null || rank === null || !isToken(overrideKey) || !isExactCanonicalKey(sourceKey)) return;
        const target = profile.value.affinities.find((a) => a.affinity.entityVersionId === ref.entityVersionId && a.affinity.entityId === ref.entityId && a.rank === rank);
        if (target === undefined) p.add(A.INVALID_PROGRESSION_REQUEST, ["overrides", i], "an override names an exact owned Affinity at its owned rank");
        else overridden.push({ overrideKey, affinity: target.affinity, rank, sourceKey });
      });
  }
  if (p.count > 0) return finish(p, () => null as never);

  const wanted: Slot[] = profile.value.affinities
    .filter((a) => !overridden.some((o) => o.affinity.entityId === a.affinity.entityId))
    .map((a) => ({ role: a.role, rank: a.rank }));
  let states: PathState[] = [{ slots: [], path: [], conflicts: [] }];
  for (const step of progression.payload.levels) {
    if (step.level > level) break;
    const next = new Map<string, PathState>();
    for (const state of states) for (const option of step.options) for (const s of applyOption(state, option, step.level)) {
      const key = `${stateKey(s)}#${s.conflicts.join()}`;
      if (!next.has(key)) next.set(key, s);
    }
    states = [...next.values()];
  }
  const resolvedHit = states.find((s) => s.slots.every((x) => x.rank !== null) && matches(s, wanted));
  const unresolvedHit = resolvedHit === undefined ? states.find((s) => matches(s, wanted)) : undefined;
  const hit = resolvedHit ?? unresolvedHit;
  const upcoming = progression.payload.levels.find((l) => l.level > level);
  return finish(p, () =>
    deepFreeze({
      status: resolvedHit !== undefined ? ("VALID" as const) : unresolvedHit !== undefined ? ("REQUIRES_CANON" as const) : ("INVALID" as const),
      characterLevel: level,
      path: hit === undefined ? null : hit.path,
      unresolvedConflicts: unresolvedHit === undefined ? [] : [...new Set(unresolvedHit.conflicts)].sort(),
      overridden,
      nextOptions: upcoming === undefined ? null : { level: upcoming.level, options: upcoming.options },
    }),
  );
}
