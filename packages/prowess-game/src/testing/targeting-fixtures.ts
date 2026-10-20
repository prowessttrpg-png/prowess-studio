import { createRulesetContext, orchestrateRulesEvaluation, type EvaluationRun, type RulesetContext } from "@prowess/rules";
import { createProwessDefinitionBundle, type ProwessDefinitionBundle } from "../bundle/bundle.js";
import type { ProwessDefinitionRef } from "../definition/envelope.js";
import { PROWESS_DEFINITION_KINDS, type ProwessDefinitionKind } from "../vocabulary/families.js";
import targetingContent from "../content/core-playtest-v0.1/targeting.json";
import { compileAbilityTargeting, readAbilityTargetingRun, type AbilityTargetingResult, type ProwessTargetingCompiledPlan } from "../targeting/compile.js";
import { AFFINITY_DEFINITIONS, keywordCatalog } from "./affinity-fixtures.js";
import { PLAYTEST_DEFINITIONS } from "./core-fixtures.js";
import { conditionPayload, effectPayload, targetingPayload, uuid } from "./fixtures.js";

/**
 * Test fixtures for M5-WO6 (not public surface). The canonical core and Targeting Definitions come from the content files
 * — never TypeScript. The Effect / Duration / Condition / Foundation components below are NEUTRAL structural test
 * components (the Effect catalog is M5-WO7): only their explicit TARGETING compatibility rules carry meaning here.
 */
export interface TargetingContentDefinition {
  readonly canonicalKey: string;
  readonly definitionKind: ProwessDefinitionKind;
  readonly schemaVersion: number;
  readonly payload: Record<string, unknown>;
}
export const TARGETING_CONTENT = targetingContent as unknown as { readonly definitions: readonly TargetingContentDefinition[]; readonly deferred: readonly { conflictKey: string; subject: string }[]; readonly [k: string]: unknown };

const component = (canonicalKey: string, definitionKind: ProwessDefinitionKind, payload: Record<string, unknown>): TargetingContentDefinition => ({ canonicalKey, definitionKind, schemaVersion: 1, payload });
const targetingCompat = (...allow: string[]) => ({ compatibility: [{ relation: "TARGETING", allow }] });

export const TARGETING_TEST_COMPONENTS = {
  // Spell branch — compatibility by exact canonical key, by semantic token, or not declared.
  boltByKey: component("spell.effect.test_bolt", "SPELL_EFFECT", effectPayload("DAMAGE", targetingCompat("spell.targeting.single_target", "spell.targeting.projectile", "spell.targeting.touch"))),
  burstByShape: component("spell.effect.test_burst", "SPELL_EFFECT", effectPayload("DAMAGE", targetingCompat("RADIUS", "ZONE"))),
  undeclared: component("spell.effect.test_plain", "SPELL_EFFECT", effectPayload("UTILITY")),
  instant: component("spell.duration.instant", "SPELL_DURATION", { durationConcept: "INSTANT" }),
  verbal: component("spell.casting_condition.verbal", "SPELL_CASTING_CONDITION", conditionPayload("VERBAL")),
  // A WO1-era Targeting with no executable rule, and the historical add-on classifiers (non-canonical test Definitions).
  legacySingle: component("spell.targeting.legacy_single", "SPELL_TARGETING", targetingPayload("SINGLE_TARGET")),
  legacyTrigger: component("spell.targeting.legacy_trigger", "SPELL_TARGETING", targetingPayload("TRIGGERED")),
  legacyAnchor: component("spell.targeting.legacy_anchor", "SPELL_TARGETING", targetingPayload("ANCHOR")),
  // Maneuver branch.
  strike: component("maneuver.effect.test_strike", "MANEUVER_EFFECT", effectPayload("DAMAGE")),
  maneuverInstant: component("maneuver.duration.instant", "MANEUVER_DURATION", { durationConcept: "INSTANT" }),
  weaponAttack: component("maneuver.foundation.weapon_attack", "MANEUVER_FOUNDATION", { foundationKind: "WEAPON_ATTACK", ...targetingCompat("maneuver.targeting.single_target") }),
} as const satisfies Record<string, TargetingContentDefinition>;
export type TargetingTestComponent = keyof typeof TARGETING_TEST_COMPONENTS;

export const TARGETING_RULESET = uuid(8601);
export const TARGETING_MANIFEST = uuid(8602);
export const TARGETING_RULESET_2 = uuid(8611);
export const TARGETING_MANIFEST_2 = uuid(8612);

const CATALOG: readonly TargetingContentDefinition[] = [
  ...PLAYTEST_DEFINITIONS.map((d) => ({ ...d, schemaVersion: 1 })),
  ...AFFINITY_DEFINITIONS,
  ...TARGETING_CONTENT.definitions,
  ...Object.values(TARGETING_TEST_COMPONENTS),
];
const entityOf = (i: number) => uuid(30000 + i);
const versionOf = (i: number, revision: number) => uuid(31000 + i + revision * 500);

export interface TargetingFixture {
  readonly ruleset: RulesetContext;
  readonly bundle: ProwessDefinitionBundle;
  readonly ref: (canonicalKey: string) => ProwessDefinitionRef;
}

/** A bundle of the catalog under one exact Ruleset; `revise` replaces a payload with a new EntityVersion (revision 1). */
export function targetingFixture(options: { rulesetId?: string; manifestId?: string; revise?: Readonly<Record<string, Record<string, unknown>>>; extra?: readonly TargetingContentDefinition[] } = {}): TargetingFixture {
  const rulesetId = options.rulesetId ?? TARGETING_RULESET;
  const manifestId = options.manifestId ?? TARGETING_MANIFEST;
  const catalog = [...CATALOG, ...(options.extra ?? [])];
  const index = (d: TargetingContentDefinition) => catalog.findIndex((x) => x.canonicalKey === d.canonicalKey);
  const revision = (d: TargetingContentDefinition) => (options.revise?.[d.canonicalKey] === undefined ? 0 : 1);
  const refOf = (canonicalKey: string): ProwessDefinitionRef => {
    const d = catalog.find((x) => x.canonicalKey === canonicalKey);
    if (d === undefined) throw new Error(`no ${canonicalKey}`);
    return { entityId: entityOf(index(d)), entityVersionId: versionOf(index(d), revision(d)), canonicalKey, definitionKind: d.definitionKind, systemFamily: PROWESS_DEFINITION_KINDS[d.definitionKind].family } as unknown as ProwessDefinitionRef;
  };
  const ctx = createRulesetContext({
    rulesetId,
    manifestId,
    rules: catalog.map((d) => ({ entityId: entityOf(index(d)), entityVersionId: versionOf(index(d), revision(d)), canonicalKey: d.canonicalKey, entityType: PROWESS_DEFINITION_KINDS[d.definitionKind].entityTypes[0], sourceRulesetId: rulesetId, sourceManifestId: manifestId })),
  });
  if (!ctx.ok) throw new Error(JSON.stringify(ctx));
  const definitions = catalog.map((d) => ({
    schemaVersion: d.schemaVersion,
    systemFamily: PROWESS_DEFINITION_KINDS[d.definitionKind].family,
    definitionKind: d.definitionKind,
    entityId: entityOf(index(d)),
    entityVersionId: versionOf(index(d), revision(d)),
    canonicalKey: d.canonicalKey,
    payload: JSON.parse(JSON.stringify(options.revise?.[d.canonicalKey] ?? d.payload)) as Record<string, unknown>,
    provenance: { rulesetId, manifestId, releaseId: null, sourceRulesetId: rulesetId, sourceManifestId: manifestId, legacyTerms: d.canonicalKey === "affinity.evocation" ? [{ legacyTerm: "Emission", canonicalTerm: "Evocation" }] : [] },
  }));
  const out = createProwessDefinitionBundle({ ruleset: ctx.value, definitions });
  if (!out.ok) throw new Error(JSON.stringify(out.problems, null, 2));
  return { ruleset: ctx.value, bundle: out.value, ref: refOf };
}

export const T_FIXTURE = (() => {
  let cached: TargetingFixture | null = null;
  return () => (cached ??= targetingFixture());
})();

export interface UseSpec {
  readonly parameters?: Record<string, unknown>;
  readonly effects?: readonly string[];
  readonly foundation?: string | null;
}

/** A Spell over the canonical Spell Targeting `targetingKey` (Instant, Arcane Authority). */
export function spellWith(f: TargetingFixture, targetingKey: string, spec: UseSpec = {}): Record<string, unknown> {
  return {
    compositionKey: "composition.spell.targeting_test",
    abilityKind: "SPELL",
    affinity: null,
    authority: { authority: "ARCANE_AUTHORITY" },
    keywords: [],
    targeting: { componentKey: "targeting", definition: f.ref(targetingKey), parameters: spec.parameters ?? {} },
    effects: (spec.effects ?? ["spell.effect.test_plain"]).map((k, i) => ({ componentKey: `effect${String(i + 1)}`, order: (i + 1) * 10, definition: f.ref(k), parameters: {} })),
    traits: [],
    duration: { componentKey: "duration", definition: f.ref("spell.duration.instant"), parameters: {} },
    conditions: [],
    branch: { kind: "SPELL", effectChain: null, sustain: null, concentration: null, data: {} },
  };
}

/** A Maneuver over the canonical Maneuver Targeting `targetingKey` (weapon-attack Foundation). */
export function maneuverWith(f: TargetingFixture, targetingKey: string, spec: UseSpec = {}): Record<string, unknown> {
  return {
    compositionKey: "composition.maneuver.targeting_test",
    abilityKind: "MANEUVER",
    affinity: null,
    authority: null,
    keywords: [],
    targeting: { componentKey: "targeting", definition: f.ref(targetingKey), parameters: spec.parameters ?? {} },
    effects: (spec.effects ?? ["maneuver.effect.test_strike"]).map((k, i) => ({ componentKey: `effect${String(i + 1)}`, order: (i + 1) * 10, definition: f.ref(k), parameters: {} })),
    traits: [],
    duration: { componentKey: "duration", definition: f.ref("maneuver.duration.instant"), parameters: {} },
    conditions: [],
    branch: { kind: "MANEUVER", foundation: spec.foundation === null ? null : { componentKey: "foundation", definition: f.ref(spec.foundation ?? "maneuver.foundation.weapon_attack"), parameters: {} }, martialAccess: null, resolutionProfile: null, data: {} },
  };
}

export interface CharacterSpec {
  readonly stats?: Record<string, number>;
  readonly martial?: string;
}

export function targetingRequest(f: TargetingFixture, composition: Record<string, unknown>, c: CharacterSpec = {}, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contractVersion: 1,
    subjectKey: "golden",
    composition,
    definitions: f.bundle,
    ruleset: f.ruleset,
    character: { stats: c.stats ?? { PER: 4, PRO: 4, STR: 4 }, skillRanks: c.martial === undefined ? [] : [{ skillKey: "skill.martial", rankKey: c.martial }] },
    keywords: keywordCatalog(),
    ...extra,
  };
}

export interface TargetingRunResult {
  readonly plan: ProwessTargetingCompiledPlan;
  readonly run: EvaluationRun;
  readonly result: AbilityTargetingResult;
}

/** compile with @prowess/game → evaluate with the frozen M4 orchestrator → read back. Throws on any failure. */
export function runTargeting(request: Record<string, unknown>, f: TargetingFixture = T_FIXTURE()): TargetingRunResult {
  const plan = compileAbilityTargeting(request);
  if (!plan.ok) throw new Error(`compile failed: ${JSON.stringify(plan.problems, null, 2)}`);
  const response = orchestrateRulesEvaluation({ evaluationKey: "m5-wo6.test", contexts: { ruleset: f.ruleset }, plan: plan.value.evaluationPlan });
  if (!response.success || response.data === null) throw new Error(`M4 run failed: ${JSON.stringify(response.errors)}`);
  const failed = response.data.steps.filter((s) => s.response === null || !s.response.success);
  if (failed.length > 0) throw new Error(`steps failed: ${JSON.stringify(failed.map((s) => [s.stepKey, s.executionStatus, s.response?.errors]), null, 2)}`);
  const result = readAbilityTargetingRun({ plan: plan.value, run: response.data });
  if (!result.ok) throw new Error(`reading failed: ${JSON.stringify(result.problems)}`);
  return { plan: plan.value, run: response.data, result: result.value };
}

/** The value of one geometry measure (null when deferred / Effect-defined). */
export const measureOf = (r: TargetingRunResult, measure: string) => r.result.geometry.find((g) => g.measure === measure);
