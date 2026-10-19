import { createActorContext, createBuildContext, createRuntimeContext, createRulesetContext } from "@prowess/rules";
import { deepFreeze, isPlainObject } from "../internal/plain-data.js";
import { Problems, checkPlainData, finish, own, readRecord, type ProwessOutcome } from "../internal/problems.js";
import { COMPILATION_ERROR_CODES as X, DEFINITION_ERROR_CODES as C } from "../definition/codes.js";
import { bundleMatchesRuleset, createProwessDefinitionBundle, type ProwessDefinitionBundle } from "../bundle/bundle.js";
import { compositionComponents, validateAbilityComposition, type AbilityComposition, type ComponentUse } from "../construction/composition.js";
import { SUPPORTED_PROWESS_COMPILATION_CONTRACT_VERSIONS } from "../contract-version.js";
import { ABILITY_KINDS, type ProwessDefinitionKind } from "../vocabulary/families.js";
import { assembleCompiledPlan } from "./assemble.js";
import type { CompilationFragment, ProwessCompiledPlan } from "./model.js";

/**
 * A component compiler turns ONE exact component use into M4 fragments. It may read the exact Definition's structured
 * literal values and the use's authored parameters and emit operation templates and bindings; it may not calculate
 * (§104–107). The table is closed and static — keyed by Definition kind, frozen, no registration API.
 *
 * WO1 compiles NO mechanics (§211, §231): every entry is null, so a valid Composition compiles to a plan with zero
 * steps. M5-WO6 onward fill entries in their own Work Orders, each with its own tests and audit.
 */
type ComponentCompiler = (use: ComponentUse, composition: AbilityComposition, bundle: ProwessDefinitionBundle) => readonly CompilationFragment[];
export const COMPONENT_COMPILERS: Readonly<Record<ProwessDefinitionKind, ComponentCompiler | null>> = deepFreeze({
  CORE_RESOLUTION: null,
  CHARACTER_DIE_PROGRESSION: null,
  STAT: null,
  DERIVED_STAT: null,
  ANCESTRY: null,
  SKILL: null,
  RANK_LADDER: null,
  SKILL_RANK: null,
  RESOURCE: null,
  ACTION: null,
  CREATURE_SIZE: null,
  TERRAIN: null,
  // M5-WO4 compiles Affinity through its own subjects (affinity/compile.ts), not as an Ability component compiler.
  AFFINITY: null,
  AFFINITY_RANK_RULE: null,
  AFFINITY_WEAKNESS_SEVERITY: null,
  AFFINITY_PROGRESSION: null,
  // M5-WO5 evaluates construction legality through its own entry point (construction/legality.ts).
  ABILITY_CONSTRUCTION_RULE: null,
  SPELL_TARGETING: null,
  SPELL_EFFECT: null,
  SPELL_TRAIT: null,
  SPELL_CASTING_CONDITION: null,
  SPELL_DURATION: null,
  MANEUVER_TARGETING: null,
  MANEUVER_EFFECT: null,
  MANEUVER_TRAIT: null,
  MANEUVER_CONDITION: null,
  MANEUVER_DURATION: null,
  MANEUVER_FOUNDATION: null,
  MAGE_ART: null,
  WEAPON: null,
  ARMOR: null,
  EQUIPMENT_TRAIT: null,
  SUMMON_TYPE: null,
  SUMMON_TRAIT: null,
  SUMMON_ACTION_MODEL: null,
  STATUS_CONDITION: null,
  MISSION_RULE: null,
});

const REQUEST_FIELDS = ["contractVersion", "subject", "definitions", "ruleset", "actor", "build", "runtime"];

/**
 * Compiles an exact Prowess Ability into an M4 EvaluationPlan with its source map (§93–109). Pure and deterministic
 * (M5-I029): no input is mutated; equal requests give deep-equal, deep-frozen, JSON-safe plans.
 *
 * Fails closed when the contract version is unsupported, the subject kind and Composition kind disagree, the bundle
 * is not exactly the bundle of `ruleset` (re-validated, not trusted), or any reference does not resolve exactly.
 */
export function compileProwessAbility(request: unknown): ProwessOutcome<ProwessCompiledPlan> {
  const p = new Problems();
  if (!checkPlainData(request, [], p, C.NOT_PLAIN_DATA)) return finish(p, () => null as never);
  const r = readRecord(request, [], p, X.INVALID_REQUEST, REQUEST_FIELDS, ["contractVersion", "subject", "definitions", "ruleset"]);
  if (r === null) return finish(p, () => null as never);

  const contractVersion = own(r, "contractVersion");
  if (typeof contractVersion !== "number" || !SUPPORTED_PROWESS_COMPILATION_CONTRACT_VERSIONS.includes(contractVersion)) {
    p.add(X.UNSUPPORTED_CONTRACT_VERSION, ["contractVersion"], `supported Prowess compilation contract versions: ${SUPPORTED_PROWESS_COMPILATION_CONTRACT_VERSIONS.join(", ")}`);
  }

  const ruleset = createRulesetContext(own(r, "ruleset"));
  if (!ruleset.ok) p.add(X.INVALID_REQUEST, ["ruleset"], "an exact, valid M4 RulesetContext is required");
  for (const [field, create] of [["actor", createActorContext], ["build", createBuildContext], ["runtime", createRuntimeContext]] as const) {
    const value = own(r, field);
    if (value !== undefined && !create(value).ok) p.add(X.INVALID_REQUEST, [field], `${field} must be a valid M4 ${field} context`);
  }

  // The bundle is re-validated against the request's exact context: a bundle is never trusted by shape.
  const rawBundle = own(r, "definitions");
  if (!isPlainObject(rawBundle)) p.add(X.INVALID_REQUEST, ["definitions"], "definitions is the exact ProwessDefinitionBundle of the request's RulesetContext");
  const bundle = ruleset.ok && isPlainObject(rawBundle) ? createProwessDefinitionBundle({ ruleset: own(r, "ruleset"), definitions: own(rawBundle as Record<string, unknown>, "definitions") ?? null }) : null;
  if (bundle !== null && !bundle.ok) {
    for (const problem of bundle.problems) p.list.push({ ...problem, path: `/definitions${problem.path}` });
  } else if (bundle !== null && ruleset.ok) {
    const supplied = own(rawBundle as Record<string, unknown>, "rulesetProvenance");
    if (!bundleMatchesRuleset({ rulesetProvenance: supplied as ProwessDefinitionBundle["rulesetProvenance"], definitions: [] }, ruleset.value)) {
      p.add(X.BUNDLE_RULESET_MISMATCH, ["definitions", "rulesetProvenance"], "the Definition bundle was materialized for a different exact Ruleset context");
    }
  }

  const subject = readRecord(own(r, "subject"), ["subject"], p, X.INVALID_REQUEST, ["kind", "composition"], ["kind", "composition"]);
  if (p.count > 0 || subject === null || bundle === null || !bundle.ok) return finish(p, () => null as never);

  const kind = own(subject, "kind");
  if (!(ABILITY_KINDS as readonly unknown[]).includes(kind)) {
    p.add(X.INVALID_REQUEST, ["subject", "kind"], `subject kind is explicit: ${ABILITY_KINDS.join(" | ")}`);
    return finish(p, () => null as never);
  }
  const composition = validateAbilityComposition(own(subject, "composition"), { bundle: bundle.value });
  if (!composition.ok) {
    for (const problem of composition.problems) p.list.push({ ...problem, path: `/subject/composition${problem.path}` });
    return finish(p, () => null as never);
  }
  if (composition.value.abilityKind !== kind) {
    p.add(X.SUBJECT_MISMATCH, ["subject", "kind"], `subject kind ${String(kind)} disagrees with the Composition's explicit abilityKind ${composition.value.abilityKind}`);
    return finish(p, () => null as never);
  }

  const fragments = compositionComponents(composition.value).flatMap(({ use }) => {
    const compiler = COMPONENT_COMPILERS[use.definition.definitionKind];
    return compiler === null ? [] : compiler(use, composition.value, bundle.value);
  });
  return assembleCompiledPlan({ composition: composition.value, bundle: bundle.value, fragments });
}
