import { createRulesetContext, orchestrateRulesEvaluation, type EvaluationRun } from "@prowess/rules";
import { createProwessDefinitionBundle } from "../bundle/bundle.js";
import type { ProwessDefinitionRef } from "../definition/envelope.js";
import { compileManeuverCost, readManeuverCostRun, type ManeuverCostResult, type ProwessManeuverCostCompiledPlan } from "../ability/maneuver-cost.js";
import { MANEUVER_COST_CONTENT } from "../content/core-playtest-v0.1/maneuver-cost.js";
import { PROWESS_DEFINITION_KINDS, type ProwessDefinitionKind } from "../vocabulary/families.js";
import { copy, durationConditionFixture, setPath } from "./duration-condition-fixtures.js";
import { effectCharacter } from "./effect-fixtures.js";
import { uuid } from "./fixtures.js";

/**
 * M5-WO11 TEST fixtures (not canonical content, not public surface). The Core Playtest foundation table (Light 1 · Balanced
 * 2 · Heavy 3 · Move 1 · Block 2 AP) is authored here as exact test Attacks / actions bound to neutral test weapons, because
 * no canonical foundation catalog is materialized yet; Effects are neutral copies of the canonical Elemental Damage
 * Conversion grammar with only their listed costs changed. Canonical WO9 Maneuver Conditions / Durations come from content.
 */
type Row = { canonicalKey: string; definitionKind: ProwessDefinitionKind; payload: Record<string, unknown> };
export interface ManeuverSpec {
  /** [actionKey, foundation fixture suffix] in authored order. */
  readonly actions: readonly (readonly [string, string])[];
  /** [effectKey, effect fixture suffix or canonical key, attached action keys, parameters]. */
  readonly effects?: readonly (readonly [string, string, readonly string[], Record<string, unknown>?])[];
  /** [canonical maneuver.condition.<key>, parameters]. */
  readonly conditions?: readonly (readonly [string, Record<string, unknown>?])[];
  readonly powerfulBlow?: readonly string[];
}

export function maneuverCostFixture(options: { rulesetId?: string; manifestId?: string; revise?: Readonly<Record<string, Record<string, unknown>>>; maneuvers?: Readonly<Record<string, ManeuverSpec>>; policy?: Record<string, unknown> | null } = {}) {
  const rule = copy(MANEUVER_COST_CONTENT.constructionRule.payload) as Record<string, unknown>;
  if (options.policy === null) delete rule.maneuverCostPolicy;
  else if (options.policy) rule.maneuverCostPolicy = { ...(rule.maneuverCostPolicy as Record<string, unknown>), ...options.policy };
  const base = durationConditionFixture({ rulesetId: options.rulesetId, manifestId: options.manifestId, revise: { "construction.ability_rules": rule, ...(options.revise ?? {}) } });
  const rows: Row[] = [];
  const ref = (key: string): ProwessDefinitionRef => {
    const i = rows.findIndex((x) => x.canonicalKey === key);
    if (i < 0) return base.ref(key);
    const row = rows[i]!;
    return { entityId: uuid(91000 + i), entityVersionId: uuid((options.revise?.[key] ? 95000 : 93000) + i), canonicalKey: key, definitionKind: row.definitionKind, systemFamily: PROWESS_DEFINITION_KINDS[row.definitionKind].family } as ProwessDefinitionRef;
  };
  const add = (canonicalKey: string, definitionKind: ProwessDefinitionKind, payload: Record<string, unknown>) => rows.push({ canonicalKey, definitionKind, payload });
  const common = (extra: object) => ({ keywords: [], parameters: {}, compatibility: [], costContributions: [], rules: {}, ...extra });
  const ap = (key: string, amount: number) => ({ contributionKey: key, currency: "AP", data: { kind: "FIXED", amount } });
  const single = { componentKey: "targeting", definition: base.ref("maneuver.targeting.single_target"), parameters: {} };
  const self = { componentKey: "targeting", definition: base.ref("maneuver.targeting.self"), parameters: {} };
  const attack = (weaponKey: string, cost: number, dice = "1d8") => common({ foundationKind: "WEAPON_ATTACK", costContributions: cost < 0 ? [] : [ap("foundation.ap", cost)], rules: { attack: { category: "MELEE", targeting: single, range: { kind: "WEAPON_RANGE", feet: 5 }, resolution: { mode: "ATTACK_ROLL", stat: "STR" }, damage: { kind: "WEAPON", weaponKey, baseDice: dice, power: 5, stat: "STR", enchantments: [] } } } });
  add("fixture.wo11.attack.light", "MANEUVER_FOUNDATION", attack("fixture.weapon.dagger", 1, "1d4")); // Light Weapon Attack 1 AP
  add("fixture.wo11.attack.longsword", "MANEUVER_FOUNDATION", attack("fixture.weapon.longsword", 2)); // Balanced 2 AP
  add("fixture.wo11.attack.heavy", "MANEUVER_FOUNDATION", attack("fixture.weapon.hammer", 3, "1d10")); // Heavy 3 AP
  add("fixture.wo11.attack.shield_bash", "MANEUVER_FOUNDATION", attack("fixture.weapon.shield", 1, "1d4"));
  add("fixture.wo11.attack.unpriced", "MANEUVER_FOUNDATION", attack("fixture.weapon.longsword", -1));
  const action = (category: string, cost: number) => common({ foundationKind: "ACTION", costContributions: [ap("foundation.ap", cost)], rules: { action: { category, targeting: self } } });
  add("fixture.wo11.action.move", "MANEUVER_FOUNDATION", action("MOVEMENT", 1));
  add("fixture.wo11.action.block", "MANEUVER_FOUNDATION", action("DEFENSE", 2));

  const conversion = base.bundle.definitions.find((d) => d.canonicalKey === "maneuver.effect.elemental_damage_conversion")!.payload as Record<string, unknown>;
  const effect = (costs: unknown[], extraParameters: unknown[] = []) => {
    const e = copy(conversion);
    setPath(e, "keywords", []);
    setPath(e, "costContributions", costs);
    const params = (e as { rules: { effect: { parameters: unknown[] } } }).rules.effect.parameters;
    params.push(...extraParameters);
    return e;
  };
  add("fixture.wo11.effect.push", "MANEUVER_EFFECT", effect([ap("effect.push.ap", 1)]));
  add("fixture.wo11.effect.knockback", "MANEUVER_EFFECT", effect([ap("effect.knockback.ap", 2)]));
  add("fixture.wo11.effect.armor_break", "MANEUVER_EFFECT", effect([ap("effect.armor_break.ap", 2)]));
  // "+1 AP OR +4 MP": two PER_SELECTION costs keyed by one TOKEN with NO default — the authored Maneuver must choose.
  add("fixture.wo11.effect.mana_wrapped", "MANEUVER_EFFECT", effect([
    { contributionKey: "effect.mana_wrapped.ap", currency: "AP", data: { kind: "PER_SELECTION", parameter: "costOption", amounts: { AP: 1, MP: 0 } } },
    { contributionKey: "effect.mana_wrapped.mp", currency: "MP", data: { kind: "PER_SELECTION", parameter: "costOption", amounts: { AP: 0, MP: 4 } } },
  ], [{ parameter: "costOption", kind: "TOKEN", allowed: ["AP", "MP"], default: null }]));
  // "+2 AP AND +8 MP": both currencies always apply.
  add("fixture.wo11.effect.surge", "MANEUVER_EFFECT", effect([ap("effect.surge.ap", 2), { contributionKey: "effect.surge.mp", currency: "MP", data: { kind: "FIXED", amount: 8 } }]));
  // Effect-specific Affinity rule: 5 MP, −1 / −2 / −3 by the highest relevant Affinity rank, minimum 2 MP.
  add("fixture.wo11.effect.elemental", "MANEUVER_EFFECT", effect([{ contributionKey: "effect.elemental.mp", currency: "MP", data: { kind: "FIXED", amount: 5, affinityReduction: { affinities: [base.ref("affinity.transmutation"), base.ref("affinity.evocation")], byRank: { NONE: 0, TRAINED: 1, EXPERT: 2, MASTER: 3 }, minimum: 2 } } }]));
  const guard = copy(conversion);
  setPath(guard, "keywords", []);
  setPath(guard, "effectFamily", "BUFF");
  setPath(guard, "resolution", { mode: "AUTOMATIC", data: {} });
  setPath(guard, "compatibility", [{ relation: "TARGETING", allow: ["SELF"] }]);
  setPath(guard, "outcomes", [{ outcomeKey: "SUCCESS", data: { operations: [{ kind: "UTILITY", data: { function: "GUARD" } }] } }, { outcomeKey: "FAILURE", data: { operations: [{ kind: "NO_EFFECT", data: {} }] } }]);
  setPath(guard, "costContributions", [ap("effect.guard.ap", 1)]);
  setPath(guard, "rules/effect", { ...(guard as { rules: { effect: Record<string, unknown> } }).rules.effect, effectSubfamily: null, targetCategories: ["SELF"], resolutionPolicy: "OWN", parameters: [], restrictions: [] });
  add("fixture.wo11.effect.guard", "MANEUVER_EFFECT", guard);

  const maneuver = (key: string, s: ManeuverSpec) => {
    const actions = s.actions.map(([componentKey, foundation], i) => ({ componentKey, order: 10 * (i + 1), definition: ref(`fixture.wo11.${foundation}`), parameters: {} }));
    const effects = (s.effects ?? []).map(([componentKey, e, , parameters], i) => ({ componentKey, order: 10 * (i + 1), definition: ref(e.includes(".") ? e : `fixture.wo11.effect.${e}`), parameters: parameters ?? {} }));
    const conditions = (s.conditions ?? []).map(([k, parameters], i) => ({ componentKey: `condition${String(i + 1)}`, order: 10 * (i + 1), definition: ref(`maneuver.condition.${k}`), parameters: parameters ?? {} }));
    add(key, "MANEUVER_DEFINITION", {
      name: key, description: "Deterministic WO11 reference Maneuver",
      composition: { compositionKey: key, abilityKind: "MANEUVER", affinity: null, authority: null, keywords: [], effects, traits: [], duration: { componentKey: "duration", definition: ref("maneuver.duration.instant"), parameters: {} }, conditions },
      actions, effectAttachments: (s.effects ?? []).map(([effectKey, , actionKeys]) => ({ effectKey, actionKeys: [...actionKeys] })), powerfulBlow: s.powerfulBlow ? { actionKeys: [...s.powerfulBlow] } : null,
    });
  };
  for (const [key, s] of Object.entries({ ...DEFAULT_MANEUVERS, ...(options.maneuvers ?? {}) })) maneuver(key, s);

  const context = createRulesetContext({ ...base.ruleset, rules: [...base.ruleset.rules, ...rows.map((r) => ({ entityId: ref(r.canonicalKey).entityId, entityVersionId: ref(r.canonicalKey).entityVersionId, canonicalKey: r.canonicalKey, entityType: PROWESS_DEFINITION_KINDS[r.definitionKind].entityTypes[0], sourceRulesetId: base.ruleset.rulesetId, sourceManifestId: base.ruleset.manifestId }))] });
  if (!context.ok) throw new Error(JSON.stringify(context.errors));
  const definitions = [...base.bundle.definitions, ...rows.map((row) => ({ ...ref(row.canonicalKey), schemaVersion: 1, payload: options.revise?.[row.canonicalKey] ?? row.payload, provenance: { rulesetId: context.value.rulesetId, manifestId: context.value.manifestId, releaseId: null, sourceRulesetId: context.value.rulesetId, sourceManifestId: context.value.manifestId, legacyTerms: [] } }))];
  const bundle = createProwessDefinitionBundle({ ruleset: context.value, definitions });
  if (!bundle.ok) throw new Error(JSON.stringify(bundle.problems, null, 2));
  const rowPayload = (key: string) => copy(rows.find((x) => x.canonicalKey === key)!.payload);
  const request = (key: string, signatureManeuver = false, character: Record<string, unknown> = effectCharacter()) => ({ ...base.request(undefined, character as ReturnType<typeof effectCharacter>), subjectKey: "wo11", definition: ref(key), definitions: bundle.value, ruleset: context.value, signatureManeuver });
  return { ruleset: context.value, bundle: bundle.value, ref, rowPayload, request };
}

/** One Maneuver per golden / trace (M5-WO11). Character: Martial MASTER (3 Effects, 3 Conditions), PRO 4. */
export const DEFAULT_MANEUVERS: Readonly<Record<string, ManeuverSpec>> = {
  // A — Balanced 2 + Push 1 − Stationary 1 = 2 AP, 0 MP.
  "fixture.wo11.maneuver.basic": { actions: [["attack1", "attack.longsword"]], effects: [["effect1", "push", ["attack1"]]], conditions: [["stationary"]] },
  // B — Heavy 3 + Knockback 2 + Armor Break 2 = 7 − 2 = 5 AP (no 3 AP cap).
  "fixture.wo11.maneuver.high": { actions: [["attack1", "attack.heavy"]], effects: [["effect1", "knockback", ["attack1"]], ["effect2", "armor_break", ["attack1"]]], conditions: [["target_unaware"]] },
  // C — Longsword ×2 SEPARATE + Push 1 = 5 − 3 = 2; attack floor 2 → 2 AP.
  "fixture.wo11.maneuver.multi": { actions: [["attack1", "attack.longsword"], ["attack2", "attack.longsword"]], effects: [["effect1", "push", ["attack1"]]], conditions: [["target_unaware"], ["stationary"]] },
  // D — Powerful Blow Heavy ×2 (6) + Knockback 2 = 8 − 3 = 5; ONE resolution, floor 1 → 5 AP.
  "fixture.wo11.maneuver.powerful_blow": { actions: [["attack1", "attack.heavy"], ["attack2", "attack.heavy"]], effects: [["effect1", "knockback", ["attack1", "attack2"]]], conditions: [["target_unaware"], ["stationary"]], powerfulBlow: ["attack1", "attack2"] },
  // E — Longsword 2 + Mana-Wrapped (AP) = 3 AP, 0 MP; (MP) = 2 AP, 4 MP.
  "fixture.wo11.maneuver.option_ap": { actions: [["attack1", "attack.longsword"]], effects: [["effect1", "mana_wrapped", ["attack1"], { costOption: "AP" }]] },
  "fixture.wo11.maneuver.option_mp": { actions: [["attack1", "attack.longsword"]], effects: [["effect1", "mana_wrapped", ["attack1"], { costOption: "MP" }]] },
  "fixture.wo11.maneuver.option_missing": { actions: [["attack1", "attack.longsword"]], effects: [["effect1", "mana_wrapped", ["attack1"]]] },
  // F — Longsword 2 + Surge (2 AP AND 8 MP) − No Counter Action (MP −3) = 4 AP, 5 MP.
  "fixture.wo11.maneuver.mana": { actions: [["attack1", "attack.longsword"]], effects: [["effect1", "surge", ["attack1"]]], conditions: [["no_counter_action", { benefit: "MP" }]] },
  // G — Longsword 2 + Knockback 2 + Armor Break 2 = 6 − (Unaware 2 + Stationary 1 = 3, the cap) = 3 AP.
  "fixture.wo11.maneuver.capped": { actions: [["attack1", "attack.longsword"]], effects: [["effect1", "knockback", ["attack1"]], ["effect2", "armor_break", ["attack1"]]], conditions: [["target_unaware"], ["stationary"]] },
  // Over-cap: listed 2 + 1 + 1 = 4 → WO9 effective 3 (and WO9 marks the over-cap selection INVALID).
  "fixture.wo11.maneuver.over_cap": { actions: [["attack1", "attack.longsword"]], effects: [["effect1", "knockback", ["attack1"]], ["effect2", "armor_break", ["attack1"]]], conditions: [["target_unaware"], ["stationary"], ["cannot_crit", { benefit: "AP" }]] },
  // MP floor: Elemental (Trained → 4 MP)… use Surge-free MP 2 example: Mana-Wrapped (MP 4) − No Counter Action (−3) = 1; see goldens.
  "fixture.wo11.maneuver.mp_floor": { actions: [["attack1", "attack.light"]], effects: [["effect1", "elemental", ["attack1"]]], conditions: [["no_counter_action", { benefit: "MP" }]] },
  // Elemental (Effect-specific Affinity rule) on a Longsword: 5 MP, Expert relevant Affinity → 3 MP.
  "fixture.wo11.maneuver.elemental": { actions: [["attack1", "attack.longsword"]], effects: [["effect1", "elemental", ["attack1"]]] },
  "fixture.wo11.maneuver.elemental_canonical": { actions: [["attack1", "attack.longsword"]], effects: [["effect1", "maneuver.effect.elemental_damage_conversion", ["attack1"], { damageType: "FIRE" }]] },
  // Mixed: Powerful Blow Longsword ×2 (4) + Armor Break 2 on the Blow + Shield Bash 1 = 7 − 3 = 4; two resolutions, floor 2.
  "fixture.wo11.maneuver.mixed": { actions: [["attack1", "attack.longsword"], ["attack2", "attack.longsword"], ["attack3", "attack.shield_bash"]], effects: [["effect1", "armor_break", ["attack1", "attack2"]]], conditions: [["target_unaware"], ["stationary"]], powerfulBlow: ["attack1", "attack2"] },
  // Different Attacks with per-Attack attachment: Armor Break on the Longsword only.
  "fixture.wo11.maneuver.different": { actions: [["attack1", "attack.longsword"], ["attack2", "attack.shield_bash"]], effects: [["effect1", "armor_break", ["attack1"]]] },
  // J — support: Block 2 + Guard 1 = 3 − 3 = 0 → universal minimum 1 AP (no attack resolutions).
  "fixture.wo11.maneuver.support": { actions: [["action1", "action.block"]], effects: [["effect1", "guard", ["action1"]]], conditions: [["stationary"], ["no_counter_action", { benefit: "AP" }], ["cannot_crit", { benefit: "AP" }]] },
  // Signature on two separate attacks: Light ×2 (2) + Knockback 2 = 4 − 2 = 2 (floor 2) → Signature 1 AP.
  "fixture.wo11.maneuver.signature_multi": { actions: [["attack1", "attack.light"], ["attack2", "attack.light"]], effects: [["effect1", "knockback", ["attack1"]]], conditions: [["target_unaware"]] },
  // Commitment boundary: Light 1 + Knockback 2 + Push… Base 5 − 3 − Signature 1 = 1; Base AP stays 5.
  "fixture.wo11.maneuver.commitment": { actions: [["attack1", "attack.longsword"]], effects: [["effect1", "knockback", ["attack1"]], ["effect2", "push", ["attack1"]]], conditions: [["target_unaware"], ["stationary"]] },
};

export interface ManeuverCostRun {
  readonly plan: ProwessManeuverCostCompiledPlan;
  readonly run: EvaluationRun;
  readonly result: ManeuverCostResult;
}

/** compile → M4 → read. Throws on any failure. */
export function runManeuverCost(request: Record<string, unknown>): ManeuverCostRun {
  const plan = compileManeuverCost(request);
  if (!plan.ok) throw new Error(`compile failed: ${JSON.stringify(plan.problems, null, 2)}`);
  const response = orchestrateRulesEvaluation({ evaluationKey: "m5-wo11.test", contexts: { ruleset: request.ruleset }, plan: plan.value.evaluationPlan });
  if (!response.success || response.data === null) throw new Error(`M4 run failed: ${JSON.stringify(response.errors)}`);
  const failed = response.data.steps.filter((s) => s.response === null || !s.response.success);
  if (failed.length > 0) throw new Error(`steps failed: ${JSON.stringify(failed.map((s) => [s.stepKey, s.executionStatus, s.response?.errors]), null, 2)}`);
  const result = readManeuverCostRun(plan.value, response.data);
  if (!result.ok) throw new Error(`reading failed: ${JSON.stringify(result.problems)}`);
  return { plan: plan.value, run: response.data, result: result.value };
}

export const maneuverCostCharacter = (affinity: readonly [ProwessDefinitionRef, string] | null = null, martial = "MASTER") => ({ ...effectCharacter({ martial }), affinityProfile: affinity === null ? null : { affinities: [{ affinity: affinity[0], rank: affinity[1], role: "PRIMARY", acquisition: null }] } });
