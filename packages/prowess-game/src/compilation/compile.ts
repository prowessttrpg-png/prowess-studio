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
  // M5-WO5 construction legality compiles through construction/legality.ts; this Definition is not an Ability component.
  ABILITY_CONSTRUCTION_RULE: null,
  // M5-WO4 compiles Affinity through its own subjects (affinity/compile.ts), not as an Ability component compiler.
  AFFINITY: null,
  AFFINITY_RANK_RULE: null,
  AFFINITY_WEAKNESS_SEVERITY: null,
  AFFINITY_PROGRESSION: null,
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

  const rawSubject = own(r, "subject");
  const subjectRecord = readRecord(rawSubject, ["subject"], p, X.INVALID_REQUEST, ["kind", "composition"], ["kind", "composition"]);
  let subjectKind: (typeof ABILITY_KINDS)[number] | null = null;
  let composition: AbilityComposition | null = null;
  if (subjectRecord !== null) {
    const k = own(subjectRecord, "kind");
    subjectKind = typeof k === "string" && (ABILITY_KINDS as readonly string[]).includes(k) ? (k as (typeof ABILITY_KINDS)[number]) : null;
    if (subjectKind === null) p.add(X.INVALID_REQUEST, ["subject", "kind"], `kind must be ${ABILITY_KINDS.join(" or ")}`);
  }

  const ruleset = createRulesetContext(own(r, "ruleset"));
  if (!ruleset.ok) p.add(X.INVALID_REQUEST, ["ruleset"], "an exact, valid M4 RulesetContext is required");

  const rawBundle = own(r, "definitions");
  let bundle: ProwessDefinitionBundle | null = null;
  if (!isPlainObject(rawBundle)) p.add(X.INVALID_REQUEST, ["definitions"], "definitions is the exact ProwessDefinitionBundle of this RulesetContext");
  else if (ruleset.ok) {
    const rebuilt = createProwessDefinitionBundle({ ruleset: own(r, "ruleset"), definitions: own(rawBundle, "definitions") ?? null });
    if (!rebuilt.ok) for (const problem of rebuilt.problems) p.list.push({ ...problem, path: `/definitions${problem.path}` });
    else if (!bundleMatchesRuleset({ rulesetProvenance: own(rawBundle, "rulesetProvenance") as ProwessDefinitionBundle["rulesetProvenance"], definitions: [] }, ruleset.value)) {
      p.add(X.BUNDLE_RULESET_MISMATCH, ["definitions", "rulesetProvenance"], "the Definition bundle belongs to a different exact Ruleset");
    } else bundle = rebuilt.value;
  }

  if (subjectRecord !== null && bundle !== null) {
    const validated = validateAbilityComposition(own(subjectRecord, "composition"), { bundle });
    if (!validated.ok) for (const problem of validated.problems) p.list.push({ ...problem, path: `/subject/composition${problem.path}` });
    else composition = validated.value;
  }

  if (composition !== null && subjectKind !== null && composition.abilityKind !== subjectKind) {
    p.add(X.SUBJECT_MISMATCH, ["subject", "kind"], `subject kind ${subjectKind} does not match composition abilityKind ${composition.abilityKind}`);
  }

  if (p.count > 0 || composition === null || bundle === null || !ruleset.ok) return finish(p, () => null as never);

  const actor = own(r, "actor") === undefined ? null : createActorContext(own(r, "actor"));
  const build = own(r, "build") === undefined ? null : createBuildContext(own(r, "build"));
  const runtime = own(r, "runtime") === undefined ? null : createRuntimeContext(own(r, "runtime"));
  if (actor !== null && !actor.ok) p.add(X.INVALID_REQUEST, ["actor"], "actor is not a valid M4 ActorContext");
  if (build !== null && !build.ok) p.add(X.INVALID_REQUEST, ["build"], "build is not a valid M4 BuildContext");
  if (runtime !== null && !runtime.ok) p.add(X.INVALID_REQUEST, ["runtime"], "runtime is not a valid M4 RuntimeContext");
  if (p.count > 0) return finish(p, () => null as never);

  const fragments: CompilationFragment[] = [];
  for (const component of compositionComponents(composition)) {
    const compiler = COMPONENT_COMPILERS[component.use.definition.definitionKind];
    if (compiler !== null) fragments.push(...compiler(component.use, composition, bundle));
  }

  return finish(p, () =>
    assembleCompiledPlan({
      contractVersion,
      subject: { kind: subjectKind as (typeof ABILITY_KINDS)[number], composition },
      ruleset: ruleset.value,
      bundle,
      fragments,
      contexts: {
        actor: actor?.ok ? actor.value : null,
        build: build?.ok ? build.value : null,
        runtime: runtime?.ok ? runtime.value : null,
      },
    }),
  );
}
