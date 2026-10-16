import { createRulesetContext, type RulesetContext } from "@prowess/rules";
import type { EntityType } from "@prowess/model";
import type { ProwessDefinitionRef } from "../definition/envelope.js";
import type { ProwessDefinitionKind, ProwessSystemFamily } from "../vocabulary/families.js";
import { PROWESS_DEFINITION_KINDS } from "../vocabulary/families.js";

/**
 * Neutral test fixtures for @prowess/game's own suites (not part of the public surface). Identifiers are fixed UUIDs;
 * payloads are structural examples, NOT Prowess catalog content — no real cost, range or Save value appears here.
 */
export const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const RULESET_A = uuid(9001);
export const MANIFEST_A = uuid(9002);
export const RULESET_B = uuid(9011);
export const MANIFEST_B = uuid(9012);

export interface FixtureDefinition {
  readonly n: number;
  readonly version: number;
  readonly kind: ProwessDefinitionKind;
  readonly canonicalKey: string;
  readonly payload: Record<string, unknown>;
  readonly entityType?: EntityType;
  readonly legacyTerms?: readonly { legacyTerm: string; canonicalTerm: string }[];
}

export const targetingPayload = (semanticShape: string, extra: Record<string, unknown> = {}) => ({
  semanticShape,
  geometry: { origin: "CASTER", area: { parameter: "radius" } },
  costContributions: [{ contributionKey: "shape", currency: "MP", data: { authored: "see Definition table" } }],
  ...extra,
});
export const effectPayload = (effectFamily: string, extra: Record<string, unknown> = {}) => ({
  effectFamily,
  resolution: { mode: "SAVING_THROW", data: { authored: true } },
  outcomes: [{ outcomeKey: "on-fail", data: { authored: true } }],
  ...extra,
});
export const traitPayload = (traitFamily: string, scope: string, extra: Record<string, unknown> = {}) => ({ traitFamily, scope, ...extra });
export const durationPayload = (durationConcept: string) => ({ durationConcept });
export const conditionPayload = (restrictionKey: string, extra: Record<string, unknown> = {}) => ({ restriction: { restrictionKey, data: {} }, tradeoff: { authored: true }, ...extra });

/** The fixture catalog: Spell and Maneuver branches deliberately share semantic shapes but never identity. */
export const DEFS = {
  spellRadius: { n: 1, version: 101, kind: "SPELL_TARGETING", canonicalKey: "spell.targeting.radius", payload: targetingPayload("RADIUS") },
  maneuverRadius: { n: 2, version: 102, kind: "MANEUVER_TARGETING", canonicalKey: "maneuver.targeting.radius", payload: targetingPayload("RADIUS") },
  spellDamage: { n: 3, version: 103, kind: "SPELL_EFFECT", canonicalKey: "spell.effect.direct_damage", payload: effectPayload("DAMAGE") },
  spellMovement: { n: 4, version: 104, kind: "SPELL_EFFECT", canonicalKey: "spell.effect.push", payload: effectPayload("MOVEMENT") },
  maneuverShockwave: { n: 5, version: 105, kind: "MANEUVER_EFFECT", canonicalKey: "maneuver.effect.shockwave", payload: effectPayload("DAMAGE") },
  maneuverTrip: { n: 6, version: 106, kind: "MANEUVER_EFFECT", canonicalKey: "maneuver.effect.trip", payload: effectPayload("CONTROL") },
  spellFire: { n: 7, version: 107, kind: "SPELL_TRAIT", canonicalKey: "spell.trait.fire_conversion", payload: traitPayload("DAMAGE_CONVERSION", "EFFECT_SPECIFIC") },
  maneuverKnockback: { n: 8, version: 108, kind: "MANEUVER_TRAIT", canonicalKey: "maneuver.trait.knockback", payload: traitPayload("FORCED_MOVEMENT", "EFFECT_SPECIFIC") },
  spellTimed: { n: 9, version: 109, kind: "SPELL_DURATION", canonicalKey: "spell.duration.rounds", payload: durationPayload("ROUNDS") },
  maneuverInstant: { n: 10, version: 110, kind: "MANEUVER_DURATION", canonicalKey: "maneuver.duration.instant", payload: durationPayload("INSTANT") },
  spellVerbal: { n: 11, version: 111, kind: "SPELL_CASTING_CONDITION", canonicalKey: "spell.casting_condition.verbal", payload: conditionPayload("VERBAL") },
  maneuverStationary: { n: 12, version: 112, kind: "MANEUVER_CONDITION", canonicalKey: "maneuver.condition.must_be_stationary", payload: conditionPayload("MUST_BE_STATIONARY") },
  evocation: { n: 13, version: 113, kind: "AFFINITY", canonicalKey: "affinity.evocation", payload: { affinity: "EVOCATION" }, legacyTerms: [{ legacyTerm: "Emission", canonicalTerm: "Evocation" }] },
} as const satisfies Record<string, FixtureDefinition>;
export type DefName = keyof typeof DEFS;

const defaultEntityType = (kind: ProwessDefinitionKind): EntityType => PROWESS_DEFINITION_KINDS[kind].entityTypes[0] as EntityType;

export function rulesetOf(names: readonly DefName[], ids: { rulesetId?: string; manifestId?: string; versionOffset?: number } = {}): RulesetContext {
  const ctx = createRulesetContext({
    rulesetId: ids.rulesetId ?? RULESET_A,
    manifestId: ids.manifestId ?? MANIFEST_A,
    rules: names.map((name) => {
      const d: FixtureDefinition = DEFS[name];
      return {
        entityId: uuid(d.n),
        entityVersionId: uuid(d.version + (ids.versionOffset ?? 0)),
        canonicalKey: d.canonicalKey,
        entityType: d.entityType ?? defaultEntityType(d.kind),
        sourceRulesetId: ids.rulesetId ?? RULESET_A,
        sourceManifestId: ids.manifestId ?? MANIFEST_A,
      };
    }),
  });
  if (!ctx.ok) throw new Error(JSON.stringify(ctx));
  return ctx.value;
}

export function envelopeOf(name: DefName, ruleset: RulesetContext = rulesetOf([name])): Record<string, unknown> {
  const d: FixtureDefinition = DEFS[name];
  const pinned = ruleset.rules.find((r) => r.canonicalKey === d.canonicalKey);
  return {
    schemaVersion: 1,
    systemFamily: PROWESS_DEFINITION_KINDS[d.kind].family as ProwessSystemFamily,
    definitionKind: d.kind,
    entityId: uuid(d.n),
    entityVersionId: pinned?.entityVersionId ?? uuid(d.version),
    canonicalKey: d.canonicalKey,
    payload: JSON.parse(JSON.stringify(d.payload)) as Record<string, unknown>,
    provenance: {
      rulesetId: ruleset.rulesetId,
      manifestId: ruleset.manifestId,
      releaseId: ruleset.release === null ? null : ruleset.release.releaseId,
      sourceRulesetId: pinned?.sourceRulesetId ?? null,
      sourceManifestId: pinned?.sourceManifestId ?? null,
      legacyTerms: d.legacyTerms ?? [],
    },
  };
}

export function refOf(name: DefName, versionOffset = 0): ProwessDefinitionRef {
  const d: FixtureDefinition = DEFS[name];
  return { entityId: uuid(d.n), entityVersionId: uuid(d.version + versionOffset), canonicalKey: d.canonicalKey, definitionKind: d.kind, systemFamily: PROWESS_DEFINITION_KINDS[d.kind].family } as ProwessDefinitionRef;
}

export const ALL_DEFS = Object.keys(DEFS) as DefName[];

/** "Firestorm"-style Spell: Radius + Direct Damage + Push, a Fire conversion on the damage, Rounds, Verbal, Evocation. */
export function spellComposition(): Record<string, unknown> {
  return {
    compositionKey: "composition.spell.example",
    abilityKind: "SPELL",
    affinity: { componentKey: "affinity", definition: refOf("evocation"), parameters: {} },
    authority: { arcana: "authored" },
    keywords: ["keyword.damage", "keyword.fire"],
    targeting: { componentKey: "area", definition: refOf("spellRadius"), parameters: { radius: 2 } },
    effects: [
      { componentKey: "damage", order: 10, definition: refOf("spellDamage"), parameters: { dice: 2 } },
      { componentKey: "push", order: 20, definition: refOf("spellMovement"), parameters: { distance: 1 } },
    ],
    traits: [{ componentKey: "fire", order: 10, definition: refOf("spellFire"), appliesTo: { scope: "EFFECT_SPECIFIC", componentKey: "damage" }, parameters: {} }],
    duration: { componentKey: "duration", definition: refOf("spellTimed"), parameters: { rounds: 3 } },
    conditions: [{ componentKey: "verbal", order: 10, definition: refOf("spellVerbal"), parameters: {} }],
    branch: { kind: "SPELL", effectChain: null, sustain: null, concentration: null, data: {} },
  };
}

/** "Groundbreaker"-style Maneuver: Radius + Shockwave + Trip, Knockback on the shockwave, Must Be Stationary. */
export function maneuverComposition(): Record<string, unknown> {
  return {
    compositionKey: "composition.maneuver.groundbreaker",
    abilityKind: "MANEUVER",
    affinity: { componentKey: "affinity", definition: refOf("evocation"), parameters: {} },
    authority: { martialRank: "authored" },
    keywords: [],
    targeting: { componentKey: "area", definition: refOf("maneuverRadius"), parameters: { radius: 2 } },
    effects: [
      { componentKey: "shockwave", order: 10, definition: refOf("maneuverShockwave"), parameters: {} },
      { componentKey: "trip", order: 20, definition: refOf("maneuverTrip"), parameters: {} },
    ],
    traits: [{ componentKey: "knockback", order: 10, definition: refOf("maneuverKnockback"), appliesTo: { scope: "EFFECT_SPECIFIC", componentKey: "shockwave" }, parameters: {} }],
    duration: { componentKey: "duration", definition: refOf("maneuverInstant"), parameters: {} },
    conditions: [{ componentKey: "stationary", order: 10, definition: refOf("maneuverStationary"), parameters: {} }],
    branch: { kind: "MANEUVER", foundation: null, martialAccess: null, resolutionProfile: null, data: {} },
  };
}
