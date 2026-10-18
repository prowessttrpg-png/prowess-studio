import { orderFormulaDependencies, type RuleProvenance } from "@prowess/rules";
import { deepFreeze } from "../internal/plain-data.js";
import { Problems, finish, type ProwessOutcome } from "../internal/problems.js";
import type { ProwessDefinitionBundle } from "../bundle/bundle.js";
import { CORE_ERROR_CODES as K } from "../definition/codes.js";
import { definitionRefOf, type ProwessDefinitionEnvelope, type ProwessDefinitionRef } from "../definition/envelope.js";
import type {
  CharacterDieProgressionPayload,
  CoreResolutionPayload,
  DerivedStatPayload,
  RankLadderPayload,
  SkillRankPayload,
  StatDefinitionPayload,
} from "../definition/core-payload.js";
import type { CreatureSizeDefinitionPayload } from "../definition/runtime-payload.js";
import type { CreatureSize } from "../vocabulary/runtime.js";
import { PROWESS_STATS, SKILL_RANK_LADDER_KEY, type CoreProcedure, type DerivedStatistic, type ProwessStat } from "../vocabulary/core.js";

/**
 * Role index of the exact core Definitions in ONE bundle (PAS-10 M5-WO2). A role (a Stat, the die progression, the
 * Skill rank ladder, a derived statistic, a procedure) must be filled by exactly one Definition of the bundle: a
 * missing role or two Definitions claiming one role fails closed — there is no "first wins", no fallback to another
 * Ruleset and no default content.
 */
export interface CoreEntry<P> {
  readonly ref: ProwessDefinitionRef;
  readonly payload: P;
  /** M4 rule provenance of this exact Definition under the bundle's exact Ruleset / Manifest. */
  readonly provenance: RuleProvenance;
}

export interface CoreDefinitionIndex {
  readonly stats: Readonly<Record<ProwessStat, CoreEntry<StatDefinitionPayload>>>;
  readonly progression: CoreEntry<CharacterDieProgressionPayload>;
  readonly skillLadder: CoreEntry<RankLadderPayload>;
  readonly skillRanks: CoreEntry<SkillRankPayload>;
  readonly derived: Readonly<Partial<Record<DerivedStatistic, CoreEntry<DerivedStatPayload>>>>;
  /** Derived statistics in M4's deterministic dependency order (dependencies first). */
  readonly derivedOrder: readonly DerivedStatistic[];
  readonly procedures: Readonly<Partial<Record<CoreProcedure, CoreEntry<CoreResolutionPayload>>>>;
  /** CREATURE_SIZE Definitions present in the bundle (their Base Movement feeds BASE_MOVEMENT — post-WO4 M5-SC-033). */
  readonly sizes: Readonly<Partial<Record<CreatureSize, CoreEntry<CreatureSizeDefinitionPayload>>>>;
}

function entryOf<P>(bundle: ProwessDefinitionBundle, envelope: ProwessDefinitionEnvelope): CoreEntry<P> {
  return {
    ref: definitionRefOf(envelope),
    payload: envelope.payload as unknown as P,
    provenance: {
      entityId: envelope.entityId,
      entityVersionId: envelope.entityVersionId,
      canonicalKey: envelope.canonicalKey,
      rulesetId: bundle.rulesetProvenance.rulesetId,
      manifestId: bundle.rulesetProvenance.manifestId,
    } as RuleProvenance,
  };
}

/** Indexes, and cross-validates, the core Definitions of an exact bundle. Pure; reads nothing outside the bundle. */
export function indexCoreDefinitions(bundle: ProwessDefinitionBundle): ProwessOutcome<CoreDefinitionIndex> {
  const p = new Problems();
  const roles = new Map<string, ProwessDefinitionEnvelope[]>();
  const claim = (role: string, envelope: ProwessDefinitionEnvelope) => roles.set(role, [...(roles.get(role) ?? []), envelope]);

  for (const envelope of bundle.definitions) {
    const payload = envelope.payload as Record<string, unknown>;
    switch (envelope.definitionKind) {
      case "STAT":
        claim(`stat:${String(payload.stat)}`, envelope);
        break;
      case "CHARACTER_DIE_PROGRESSION":
        claim("character-die-progression", envelope);
        break;
      case "RANK_LADDER":
        claim(`rank-ladder:${String(payload.ladderKey)}`, envelope);
        break;
      case "SKILL_RANK":
        claim(`skill-rank:${String(payload.ladderKey)}`, envelope);
        break;
      case "DERIVED_STAT":
        claim(`derived:${String(payload.statistic)}`, envelope);
        break;
      case "CORE_RESOLUTION":
        claim(`procedure:${String(payload.procedure)}`, envelope);
        break;
      case "CREATURE_SIZE":
        claim(`size:${String(payload.sizeKey)}`, envelope);
        break;
      default:
        break;
    }
  }

  const one = <P>(role: string, required: boolean): CoreEntry<P> | null => {
    const found = roles.get(role) ?? [];
    if (found.length > 1) {
      p.add(K.AMBIGUOUS_CORE_DEFINITION, ["definitions"], `${found.length} Definitions claim the core role ${role} (${found.map((e) => e.canonicalKey).join(", ")}); exactly one is required`);
      return null;
    }
    if (found.length === 0) {
      if (required) p.add(K.MISSING_CORE_DEFINITION, ["definitions"], `the bundle has no Definition for the core role ${role}`);
      return null;
    }
    return entryOf<P>(bundle, found[0] as ProwessDefinitionEnvelope);
  };

  const stats: Partial<Record<ProwessStat, CoreEntry<StatDefinitionPayload>>> = {};
  for (const stat of PROWESS_STATS) {
    const e = one<StatDefinitionPayload>(`stat:${stat}`, true);
    if (e !== null) stats[stat] = e;
  }
  const progression = one<CharacterDieProgressionPayload>("character-die-progression", true);
  const skillLadder = one<RankLadderPayload>(`rank-ladder:${SKILL_RANK_LADDER_KEY}`, true);
  const skillRanks = one<SkillRankPayload>(`skill-rank:${SKILL_RANK_LADDER_KEY}`, true);

  // The Skill rank meanings cover exactly the ladder's ranks — no rank without a meaning, no meaning without a rank.
  if (skillLadder !== null && skillRanks !== null) {
    const ladder = skillLadder.payload.ranks.map((r) => r.rankKey);
    const meant = skillRanks.payload.entries.map((e) => e.rankKey);
    if (ladder.length !== meant.length || !ladder.every((k) => meant.includes(k))) {
      p.add(K.INCONSISTENT_CORE_DEFINITIONS, ["definitions"], `SKILL_RANK entries (${meant.join(", ")}) must cover exactly the ${SKILL_RANK_LADDER_KEY} ladder ranks (${ladder.join(", ")})`);
    }
  }

  const derived: Partial<Record<DerivedStatistic, CoreEntry<DerivedStatPayload>>> = {};
  const procedures: Partial<Record<CoreProcedure, CoreEntry<CoreResolutionPayload>>> = {};
  const sizes: Partial<Record<CreatureSize, CoreEntry<CreatureSizeDefinitionPayload>>> = {};
  for (const role of [...roles.keys()].sort()) {
    const [family, key] = role.split(":") as [string, string];
    if (family === "derived") {
      const e = one<DerivedStatPayload>(role, false);
      if (e !== null) derived[key as DerivedStatistic] = e;
    } else if (family === "procedure") {
      const e = one<CoreResolutionPayload>(role, false);
      if (e !== null) procedures[key as CoreProcedure] = e;
    } else if (family === "size") {
      const e = one<CreatureSizeDefinitionPayload>(role, false);
      if (e !== null) sizes[key as CreatureSize] = e;
    }
  }

  // Derived statistics form a graph; M4 orders it (and rejects unknown dependencies and cycles).
  const nodes = Object.values(derived).map((e) => ({
    key: e.payload.statistic,
    dependencies: e.payload.formula.variables.flatMap((v) => (v.source.kind === "DERIVED" ? [v.source.statistic] : [])),
  }));
  const ordered = orderFormulaDependencies(nodes);
  if (!ordered.ok) {
    for (const d of ordered.diagnostics) p.add(K.INCONSISTENT_CORE_DEFINITIONS, ["definitions"], `derived statistics: ${d.message}`);
  }

  return finish(p, () =>
    deepFreeze({
      stats: stats as Record<ProwessStat, CoreEntry<StatDefinitionPayload>>,
      progression: progression as CoreEntry<CharacterDieProgressionPayload>,
      skillLadder: skillLadder as CoreEntry<RankLadderPayload>,
      skillRanks: skillRanks as CoreEntry<SkillRankPayload>,
      derived,
      derivedOrder: (ordered.ok ? ordered.order : []) as DerivedStatistic[],
      procedures,
      sizes,
    }),
  );
}
