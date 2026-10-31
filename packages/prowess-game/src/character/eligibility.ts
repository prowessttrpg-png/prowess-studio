import type { JsonObject } from "@prowess/model";
import { findAffinityEntry, indexAffinityDefinitions, rankEntry } from "../affinity/definitions.js";
import { ownedAffinity } from "../affinity/profile.js";
import type { ProwessDefinitionBundle } from "../bundle/bundle.js";
import { componentContractOf } from "../construction/contracts.js";
import { indexCoreDefinitions } from "../core/definitions.js";
import { readComponentConstructionRules, type AbilityConstructionRulePayload } from "../definition/ability-construction-payload.js";
import { definitionRefOf, type ProwessDefinitionEnvelope, type ProwessDefinitionRef } from "../definition/envelope.js";
import { Problems } from "../internal/problems.js";
import { deepFreeze } from "../internal/plain-data.js";
import { AFFINITY_RANKS, type AffinityRank } from "../vocabulary/affinity.js";
import type { ProwessDefinitionKind } from "../vocabulary/families.js";
import type { CharacterMechanicalProfile } from "./advancement.js";
import { rankAtLeast, requirementMet } from "./requirements.js";

/**
 * Character Access & Eligibility (PAS-10 M6-WO4 §51–§66, §103–§107) — read-only, pure, deterministic.
 *
 * Eligibility answers ONE question: does this exact Character satisfy the STRUCTURED access requirements of this exact
 * Release-pinned component Definition? It reads the component's own M5 construction sub-contract
 * (`payload.rules.construction.prerequisites`, read by M5's readComponentConstructionRules) — SKILL_RANK_AT_LEAST and
 * AFFINITY_RANK_AT_LEAST, nothing else — and asks M4 the same RANK_AT_LEAST / ENTITY_OWNED Requirements M5 Ability
 * construction compiles. Rules Text is never read. Eligibility is NOT Ability legality: capacity, structure, stacking,
 * Signature slots and Affinity Authority keyword access remain M5's complete construction compiler's (§52, §102).
 */

export type EligibilityStatus = "ELIGIBLE" | "INELIGIBLE" | "UNRESOLVED";

export interface RequirementResult {
  readonly prerequisiteKey: string;
  readonly kind: "SKILL_RANK_AT_LEAST" | "AFFINITY_RANK_AT_LEAST";
  /** What the Definition requires: the exact Skill (canonical key) or the exact Affinity, and the minimum rank. */
  readonly required: { readonly skillKey: string | null; readonly affinity: ProwessDefinitionRef | null; readonly rankKey: string };
  /** What the Character has (rank key; an unowned Affinity / untrained Skill reports the ladder's first rank). */
  readonly actual: { readonly rankKey: string; readonly owned: boolean };
  /** null when the requirement could not be evaluated (UNRESOLVED). */
  readonly satisfied: boolean | null;
  readonly source: ProwessDefinitionRef;
}

export interface ComponentEligibility {
  readonly definition: ProwessDefinitionRef | null;
  readonly status: EligibilityStatus;
  readonly requirements: readonly RequirementResult[];
  /** Why the Definition could not be evaluated (UNRESOLVED only). */
  readonly unresolved: readonly string[];
  readonly provenance: { readonly rulesetId: string; readonly manifestId: string };
}

export interface AccessTrack {
  readonly skillKey: string;
  readonly skill: ProwessDefinitionRef | null;
  readonly rankKey: string;
  readonly minimumRankKey: string;
  readonly eligible: boolean | null;
}

export interface AccessSummary {
  readonly status: "RESOLVED" | "UNRESOLVED";
  readonly unresolved: readonly string[];
  readonly spell: {
    readonly arcaneAuthority: AccessTrack | null;
    readonly affinityAuthorities: readonly { readonly affinity: ProwessDefinitionRef; readonly identity: string; readonly role: string; readonly rank: AffinityRank; readonly minimumRank: AffinityRank; readonly eligible: boolean | null }[];
  };
  readonly maneuver: { readonly martial: AccessTrack | null };
  readonly signatureCapacity: number | null;
  readonly constructionRule: ProwessDefinitionRef | null;
}

const UNOWNED: AffinityRank = AFFINITY_RANKS[0];
const skillFactKey = (skillKey: string) => `skill_rank.${skillKey}`;
const affinityFactKey = (ref: ProwessDefinitionRef) => `affinity_rank.${ref.canonicalKey}`;

interface Ctx {
  readonly bundle: ProwessDefinitionBundle;
  readonly profile: CharacterMechanicalProfile;
  readonly ladder: readonly { readonly rankKey: string; readonly order: number }[] | null;
  readonly affinity: ReturnType<typeof indexAffinityDefinitions>;
}

function contextOf(bundle: ProwessDefinitionBundle, profile: CharacterMechanicalProfile): Ctx {
  const core = indexCoreDefinitions(bundle);
  return { bundle, profile, ladder: core.ok ? core.value.skillLadder.payload.ranks : null, affinity: indexAffinityDefinitions(bundle) };
}

function skillRank(ctx: Ctx, skillKey: string): { rankKey: string; order: number; owned: boolean } | null {
  if (ctx.ladder === null) return null;
  const owned = ctx.profile.constructionContext.skillRanks.find((s) => s.skillKey === skillKey);
  const first = [...ctx.ladder].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))[0];
  const row = owned === undefined ? first : ctx.ladder.find((l) => l.rankKey === owned.rankKey);
  return row === undefined ? null : { rankKey: row.rankKey, order: row.order, owned: owned !== undefined };
}

function evaluate(ctx: Ctx, envelope: ProwessDefinitionEnvelope): ComponentEligibility {
  const ref = definitionRefOf(envelope);
  const provenance = { rulesetId: ctx.bundle.rulesetProvenance.rulesetId, manifestId: ctx.bundle.rulesetProvenance.manifestId };
  const unresolved: string[] = [];
  const requirements: RequirementResult[] = [];
  if (componentContractOf(envelope.definitionKind as ProwessDefinitionKind) === null) unresolved.push(`${envelope.definitionKind} is not an Ability component kind; it has no construction access requirements`);
  const rules = (envelope.payload as { rules?: JsonObject }).rules ?? {};
  const p = new Problems();
  const read = readComponentConstructionRules(rules, ["payload", "rules"], p);
  if (read === null) unresolved.push(...p.list.map((x) => x.message));
  if (ctx.ladder === null) unresolved.push("the Release's Skill rank ladder could not be read");
  if (!ctx.affinity.ok) unresolved.push("the Release's Affinity rules could not be read");
  if (read !== null && ctx.ladder !== null && ctx.affinity.ok) {
    const index = ctx.affinity.value;
    for (const q of read.prerequisites) {
      if (q.kind === "SKILL_RANK_AT_LEAST") {
        const required = ctx.ladder.find((l) => l.rankKey === q.minimumRank);
        const actual = skillRank(ctx, q.skillKey);
        const satisfied = required === undefined || actual === null ? null : rankAtLeast(skillFactKey(q.skillKey), actual, required);
        if (required === undefined) unresolved.push(`${q.prerequisiteKey}: ${q.minimumRank} is not a rank of the Skill rank ladder`);
        requirements.push({ prerequisiteKey: q.prerequisiteKey, kind: q.kind, required: { skillKey: q.skillKey, affinity: null, rankKey: q.minimumRank }, actual: { rankKey: actual?.rankKey ?? "", owned: actual?.owned ?? false }, satisfied, source: ref });
      } else {
        // The EXACT Affinity the Definition names — never another Affinity with overlapping Keywords (§105–§106).
        const entry = findAffinityEntry(index, q.affinity);
        const owned = ownedAffinity(ctx.profile.affinityProfile, q.affinity);
        let satisfied: boolean | null = null;
        if (entry === null) unresolved.push(`${q.prerequisiteKey}: ${q.affinity.canonicalKey} is not an executable Affinity pinned by this Release`);
        else {
          const required = rankEntry(index, q.minimumRank);
          const children: JsonObject[] = [{ kind: "ENTITY_OWNED", entityId: entry.ref.entityId, provenance: null }];
          if (owned !== null) children.push({ kind: "RANK_AT_LEAST", factKey: affinityFactKey(entry.ref), requiredRankKey: required.rank, requiredOrder: required.order, provenance: null });
          satisfied = requirementMet({ kind: "ALL", children, provenance: null }, { ownedEntityIds: ctx.profile.affinityProfile.affinities.map((a) => a.affinity.entityId), ranks: owned === null ? [] : [{ key: affinityFactKey(entry.ref), rankKey: owned.rank, order: rankEntry(index, owned.rank).order }] });
        }
        requirements.push({ prerequisiteKey: q.prerequisiteKey, kind: q.kind, required: { skillKey: null, affinity: q.affinity, rankKey: q.minimumRank }, actual: { rankKey: owned?.rank ?? UNOWNED, owned: owned !== null }, satisfied, source: ref });
      }
    }
  }
  const status: EligibilityStatus = unresolved.length > 0 || requirements.some((r) => r.satisfied === null) ? "UNRESOLVED" : requirements.every((r) => r.satisfied === true) ? "ELIGIBLE" : "INELIGIBLE";
  return deepFreeze({ definition: ref, status, requirements, unresolved, provenance });
}

/**
 * Eligibility of ONE exact Definition for this Character (§59–§62). The selection must name the exact EntityVersion the
 * Character's Release pins; anything else (another revision, another Release, an unknown Entity) is UNRESOLVED.
 */
export function evaluateComponentEligibility(request: { readonly bundle: ProwessDefinitionBundle; readonly profile: CharacterMechanicalProfile; readonly definition: { readonly entityId: string; readonly entityVersionId: string } }): ComponentEligibility {
  const { bundle, profile, definition } = request;
  const envelope = bundle.definitions.find((d) => d.entityId === definition.entityId) ?? null;
  if (envelope === null || envelope.entityVersionId !== definition.entityVersionId) {
    return deepFreeze({
      definition: envelope === null ? null : definitionRefOf(envelope),
      status: "UNRESOLVED" as const,
      requirements: [],
      unresolved: [envelope === null ? "this Entity is not part of the Character's Release" : `the Character's Release pins revision ${envelope.entityVersionId}, not ${definition.entityVersionId}`],
      provenance: { rulesetId: bundle.rulesetProvenance.rulesetId, manifestId: bundle.rulesetProvenance.manifestId },
    });
  }
  return evaluate(contextOf(bundle, profile), envelope);
}

/**
 * Eligibility of every Definition of one kind pinned by the Release (§65). The Character facts are built once and
 * reused for every Definition; nothing is cached across calls. Ordered by canonical key.
 */
export function listComponentEligibility(request: { readonly bundle: ProwessDefinitionBundle; readonly profile: CharacterMechanicalProfile; readonly definitionKind: string }): readonly ComponentEligibility[] {
  const ctx = contextOf(request.bundle, request.profile);
  const envelopes = request.bundle.definitions.filter((d) => d.definitionKind === request.definitionKind);
  const ordered = [...envelopes].sort((a, b) => (a.canonicalKey < b.canonicalKey ? -1 : a.canonicalKey > b.canonicalKey ? 1 : 0));
  return deepFreeze(ordered.map((e) => evaluate(ctx, e)));
}

/** Every component Definition of the Release whose eligibility depends on the Character (it authors a prerequisite). */
export function componentEligibilityMap(request: { readonly bundle: ProwessDefinitionBundle; readonly profile: CharacterMechanicalProfile }): ReadonlyMap<string, ComponentEligibility> {
  const ctx = contextOf(request.bundle, request.profile);
  const out = new Map<string, ComponentEligibility>();
  for (const e of request.bundle.definitions) {
    if (componentContractOf(e.definitionKind as ProwessDefinitionKind) === null) continue;
    const result = evaluate(ctx, e);
    if (result.requirements.length > 0 || result.status === "UNRESOLVED") out.set(e.entityVersionId, result);
  }
  return out;
}

/**
 * The Character's construction access summary (§56–§58): the Arcane Authority and Martial tracks (the exact Skill
 * the ABILITY_CONSTRUCTION_RULE names, at the Character's rank, against the rule's minimum) and each owned Affinity's
 * Authority (its rank against the Affinity rank rule's Authority minimum), plus the Signature capacity. Read only.
 */
export function characterAccessSummary(request: { readonly bundle: ProwessDefinitionBundle; readonly profile: CharacterMechanicalProfile }): AccessSummary {
  const ctx = contextOf(request.bundle, request.profile);
  const unresolved: string[] = [];
  const rules = request.bundle.definitions.filter((d) => d.definitionKind === "ABILITY_CONSTRUCTION_RULE");
  if (rules.length !== 1) unresolved.push(rules.length === 0 ? "the Release pins no Ability Construction Rule" : "the Release pins more than one Ability Construction Rule");
  const rule = rules.length === 1 ? (rules[0] as ProwessDefinitionEnvelope) : null;
  const R = rule === null ? null : (rule.payload as unknown as AbilityConstructionRulePayload);
  const skills = request.bundle.definitions.filter((d) => d.definitionKind === "SKILL");
  const track = (t: { readonly skillKey: string; readonly minimumRank: string } | undefined): AccessTrack | null => {
    if (t === undefined || ctx.ladder === null) return null;
    const actual = skillRank(ctx, t.skillKey);
    const required = ctx.ladder.find((l) => l.rankKey === t.minimumRank);
    const skill = skills.find((s) => s.canonicalKey === t.skillKey);
    if (skill === undefined) unresolved.push(`the Release pins no SKILL ${t.skillKey}`);
    return { skillKey: t.skillKey, skill: skill === undefined ? null : definitionRefOf(skill), rankKey: actual?.rankKey ?? "", minimumRankKey: t.minimumRank, eligible: actual === null || required === undefined ? null : rankAtLeast(skillFactKey(t.skillKey), actual, required) };
  };
  const affinityAuthorities: AccessSummary["spell"]["affinityAuthorities"][number][] = [];
  if (!ctx.affinity.ok) unresolved.push("the Release's Affinity rules could not be read");
  else {
    const index = ctx.affinity.value;
    const floor = rankEntry(index, index.rankRule.payload.authorityMinimumRank);
    for (const a of request.profile.affinityProfile.affinities) {
      const at = rankEntry(index, a.rank);
      affinityAuthorities.push({ affinity: a.affinity, identity: a.identity, role: a.role, rank: a.rank, minimumRank: floor.rank, eligible: rankAtLeast(affinityFactKey(a.affinity), { rankKey: at.rank, order: at.order }, { rankKey: floor.rank, order: floor.order }) });
    }
  }
  return deepFreeze({
    status: unresolved.length === 0 ? ("RESOLVED" as const) : ("UNRESOLVED" as const),
    unresolved,
    spell: { arcaneAuthority: track(R?.spell.arcaneAuthority), affinityAuthorities },
    maneuver: { martial: track(R?.maneuver.martial) },
    signatureCapacity: request.profile.signatureCapacity,
    constructionRule: rule === null ? null : definitionRefOf(rule),
  });
}

export interface AccessChanges {
  readonly tracks: readonly { readonly track: string; readonly before: string; readonly after: string; readonly eligibleBefore: boolean | null; readonly eligibleAfter: boolean | null }[];
  readonly signatureCapacity: { readonly before: number | null; readonly after: number | null };
  readonly newlyEligible: readonly ProwessDefinitionRef[];
  readonly newlyIneligible: readonly ProwessDefinitionRef[];
}

/** What an advancement changes in access (§63) — a read-only diff of two profiles; nothing is granted or stored. */
export function accessChanges(request: { readonly bundle: ProwessDefinitionBundle; readonly before: CharacterMechanicalProfile; readonly after: CharacterMechanicalProfile }): AccessChanges {
  const a = characterAccessSummary({ bundle: request.bundle, profile: request.before });
  const b = characterAccessSummary({ bundle: request.bundle, profile: request.after });
  const tracks: AccessChanges["tracks"][number][] = [];
  const pair = (name: string, x: AccessTrack | null, y: AccessTrack | null) => {
    if (x !== null && y !== null && (x.rankKey !== y.rankKey || x.eligible !== y.eligible)) tracks.push({ track: name, before: x.rankKey, after: y.rankKey, eligibleBefore: x.eligible, eligibleAfter: y.eligible });
  };
  pair("ARCANE_AUTHORITY", a.spell.arcaneAuthority, b.spell.arcaneAuthority);
  pair("MARTIAL", a.maneuver.martial, b.maneuver.martial);
  for (const y of b.spell.affinityAuthorities) {
    const x = a.spell.affinityAuthorities.find((z) => z.affinity.entityId === y.affinity.entityId);
    if (x === undefined || x.rank !== y.rank || x.eligible !== y.eligible) tracks.push({ track: `AFFINITY_AUTHORITY:${y.affinity.canonicalKey}`, before: x?.rank ?? UNOWNED, after: y.rank, eligibleBefore: x?.eligible ?? false, eligibleAfter: y.eligible });
  }
  const mapA = componentEligibilityMap({ bundle: request.bundle, profile: request.before });
  const mapB = componentEligibilityMap({ bundle: request.bundle, profile: request.after });
  const newlyEligible: ProwessDefinitionRef[] = [];
  const newlyIneligible: ProwessDefinitionRef[] = [];
  for (const [key, y] of mapB) {
    const x = mapA.get(key);
    if (y.definition === null) continue;
    if (y.status === "ELIGIBLE" && x?.status !== "ELIGIBLE") newlyEligible.push(y.definition);
    if (y.status !== "ELIGIBLE" && x?.status === "ELIGIBLE") newlyIneligible.push(y.definition);
  }
  return deepFreeze({ tracks, signatureCapacity: { before: request.before.signatureCapacity, after: request.after.signatureCapacity }, newlyEligible, newlyIneligible });
}
