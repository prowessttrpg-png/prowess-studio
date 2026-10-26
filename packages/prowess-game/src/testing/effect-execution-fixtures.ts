import { createRulesetContext } from "@prowess/rules";
import { createProwessDefinitionBundle } from "../bundle/bundle.js";
import type { ProwessDefinitionRef } from "../definition/envelope.js";
import { compileAbilityExecution, executeAbilityResolution, type AbilityExecutionResult } from "../ability/effect-execution.js";
import { EFFECT_EXECUTION_CONTENT } from "../content/core-playtest-v0.1/effect-execution.js";
import { PROWESS_DEFINITION_KINDS, type ProwessDefinitionKind } from "../vocabulary/families.js";
import { characterL3 } from "./core-fixtures.js";
import { copy, setPath } from "./duration-condition-fixtures.js";
import { effectCharacter } from "./effect-fixtures.js";
import { uuid } from "./fixtures.js";
import { maneuverCostFixture, type ManeuverSpec } from "./maneuver-cost-fixtures.js";

/**
 * M5-WO12 TEST fixtures (not canonical content). Spell Effects are copies of the canonical WO7 Spell Effects with the
 * Multi-Target Targeting added to their compatibility; Maneuvers reuse the WO11 reference Attacks / Effects plus the
 * canonical Sweep / Line conversions (Martial Save Profiles). Rollers are the neutral WO2 Level 3 test character (d6).
 */
type Row = { canonicalKey: string; definitionKind: ProwessDefinitionKind; payload: Record<string, unknown> };
export interface SpellChainSpec {
  readonly targeting?: string;
  readonly targetingParameters?: Record<string, unknown>;
  /** [effectKey, fixture effect suffix]. */
  readonly effects: readonly (readonly [string, string])[];
  readonly chain?: Record<string, unknown> | null;
  /** [traitKey (fixture.trait.*), effectKey] — Effect-specific Traits. */
  readonly traits?: readonly (readonly [string, string])[];
}

export function executionFixture(options: { rulesetId?: string; manifestId?: string; revise?: Readonly<Record<string, Record<string, unknown>>>; spells?: Readonly<Record<string, SpellChainSpec>>; maneuvers?: Readonly<Record<string, ManeuverSpec>>; policy?: Record<string, unknown> | null } = {}) {
  const rule = copy(EFFECT_EXECUTION_CONTENT.constructionRule.payload) as Record<string, unknown>;
  if (options.policy === null) delete rule.effectExecutionPolicy;
  else if (options.policy) rule.effectExecutionPolicy = { ...(rule.effectExecutionPolicy as Record<string, unknown>), ...options.policy };
  const base = maneuverCostFixture({ rulesetId: options.rulesetId, manifestId: options.manifestId, revise: { "construction.ability_rules": rule, ...(options.revise ?? {}) }, maneuvers: { ...DEFAULT_EXECUTION_MANEUVERS, ...(options.maneuvers ?? {}) } });
  const rows: Row[] = [];
  const ref = (key: string): ProwessDefinitionRef => {
    const i = rows.findIndex((x) => x.canonicalKey === key);
    if (i < 0) return base.ref(key);
    const row = rows[i]!;
    return { entityId: uuid(101000 + i), entityVersionId: uuid((options.revise?.[key] ? 105000 : 103000) + i), canonicalKey: key, definitionKind: row.definitionKind, systemFamily: PROWESS_DEFINITION_KINDS[row.definitionKind].family } as ProwessDefinitionRef;
  };
  const add = (canonicalKey: string, definitionKind: ProwessDefinitionKind, payload: Record<string, unknown>) => rows.push({ canonicalKey, definitionKind, payload });
  const canonical = (key: string) => copy(base.bundle.definitions.find((d) => d.canonicalKey === key)!.payload) as Record<string, unknown>;
  const widen = (key: string, edit: (e: Record<string, unknown>) => void = () => undefined) => {
    const e = canonical(key);
    setPath(e, "compatibility", [{ relation: "TARGETING", allow: ["SINGLE_TARGET", "MULTI_TARGET", "TOUCH", "PROJECTILE"] }]);
    edit(e);
    return e;
  };
  add("fixture.wo12.effect.strike", "SPELL_EFFECT", widen("spell.effect.direct_damage")); // ATTACK_ROLL
  const instant = (e: Record<string, unknown>) => setPath(e, "rules/effect/duration", { allowed: ["INSTANT", "ROUNDS"], default: "INSTANT", sustainEligible: true, manaLockEligible: false });
  add("fixture.wo12.effect.hex", "SPELL_EFFECT", widen("spell.effect.impair", instant)); // SAVING_THROW, FIXED RES
  add("fixture.wo12.effect.mend", "SPELL_EFFECT", widen("spell.effect.direct_healing")); // AUTOMATIC
  add("fixture.wo12.effect.choice", "SPELL_EFFECT", widen("spell.effect.impair", (e) => { instant(e); setPath(e, "rules/effect/saveProfile", { validSaves: ["AGI", "CON"], selectionPolicy: "TARGET_CHOICE" }); }));
  add("fixture.wo12.effect.construction_choice", "SPELL_EFFECT", widen("spell.effect.bind"));
  const parameters: Readonly<Record<string, Record<string, unknown>>> = { strike: { dice: 1 }, hex: { amount: 1 }, mend: { dice: 1 }, choice: { amount: 1 }, construction_choice: { distance: 5 } };
  const spell = (key: string, s: SpellChainSpec) => {
    const d = copy(base.bundle.definitions.find((x) => x.canonicalKey === "fixture.spell.simple")!.payload) as Record<string, unknown>;
    const use = (k: string, componentKey: string, params: Record<string, unknown> = {}) => ({ componentKey, definition: ref(k), parameters: params });
    setPath(d, "name", key);
    setPath(d, "composition/compositionKey", key);
    setPath(d, "composition/targeting", use(s.targeting ?? "spell.targeting.single_target", "targeting", s.targetingParameters ?? {}));
    setPath(d, "composition/effects", s.effects.map(([effectKey, suffix], i) => ({ ...use(`fixture.wo12.effect.${suffix}`, effectKey, parameters[suffix] ?? {}), order: 10 * (i + 1) })));
    setPath(d, "composition/traits", (s.traits ?? []).map(([t, effectKey], i) => ({ ...use(t, `trait${String(i + 1)}`), order: 10 * (i + 1), appliesTo: { scope: "EFFECT_SPECIFIC", componentKey: effectKey } })));
    setPath(d, "composition/duration", use("spell.duration.instant", "duration"));
    setPath(d, "composition/conditions", []);
    setPath(d, "composition/branch/effectChain", s.chain ?? null);
    add(key, "SPELL_DEFINITION", d);
  };
  for (const [key, s] of Object.entries({ ...DEFAULT_SPELL_CHAINS, ...(options.spells ?? {}) })) spell(key, s);

  const context = createRulesetContext({ ...base.ruleset, rules: [...base.ruleset.rules, ...rows.map((r) => ({ entityId: ref(r.canonicalKey).entityId, entityVersionId: ref(r.canonicalKey).entityVersionId, canonicalKey: r.canonicalKey, entityType: PROWESS_DEFINITION_KINDS[r.definitionKind].entityTypes[0], sourceRulesetId: base.ruleset.rulesetId, sourceManifestId: base.ruleset.manifestId }))] });
  if (!context.ok) throw new Error(JSON.stringify(context.errors));
  const definitions = [...base.bundle.definitions, ...rows.map((row) => ({ ...ref(row.canonicalKey), schemaVersion: 1, payload: options.revise?.[row.canonicalKey] ?? row.payload, provenance: { rulesetId: context.value.rulesetId, manifestId: context.value.manifestId, releaseId: null, sourceRulesetId: context.value.rulesetId, sourceManifestId: context.value.manifestId, legacyTerms: [] } }))];
  const bundle = createProwessDefinitionBundle({ ruleset: context.value, definitions });
  if (!bundle.ok) throw new Error(JSON.stringify(bundle.problems, null, 2));
  const rowPayload = (key: string) => copy(rows.find((x) => x.canonicalKey === key)?.payload ?? base.rowPayload(key));
  /** The authored-Ability request (no execution yet). */
  const ability = (key: string, martial = "MASTER") => {
    const r = base.request("fixture.wo11.maneuver.basic", false, effectCharacter({ martial })) as Record<string, unknown>;
    delete r.signatureManeuver;
    return { ...r, subjectKey: "exec", definition: ref(key), definitions: bundle.value, ruleset: context.value } as Record<string, unknown>;
  };
  return { ruleset: context.value, bundle: bundle.value, ref, rowPayload, ability };
}

/** Spell chains per golden (WO12). Single Target unless stated. */
export const DEFAULT_SPELL_CHAINS: Readonly<Record<string, SpellChainSpec>> = {
  "fixture.wo12.spell.stop": { effects: [["effect1", "strike"]], chain: { failurePolicy: "STOP", nodes: [{ effectKey: "effect1", behavior: "STOP" }] } },
  "fixture.wo12.spell.success_only": { effects: [["effect1", "strike"], ["effect2", "hex"]], chain: { failurePolicy: "STOP", nodes: [{ effectKey: "effect1", behavior: "SUCCESS_ONLY" }, { effectKey: "effect2", behavior: "STOP" }] } },
  "fixture.wo12.spell.failure_only": { effects: [["effect1", "strike"], ["effect2", "mend"]], chain: { failurePolicy: "STOP", nodes: [{ effectKey: "effect1", behavior: "FAILURE_ONLY" }, { effectKey: "effect2", behavior: "STOP" }] } },
  "fixture.wo12.spell.continue": { effects: [["effect1", "strike"], ["effect2", "mend"]], chain: { failurePolicy: "STOP", nodes: [{ effectKey: "effect1", behavior: "CONTINUE" }, { effectKey: "effect2", behavior: "STOP" }] } },
  "fixture.wo12.spell.branch": { effects: [["effect1", "strike"], ["effect2a", "mend"], ["effect2b", "hex"]], chain: { failurePolicy: "STOP", nodes: [{ effectKey: "effect1", behavior: "BRANCH", branch: { success: "effect2a", failure: "effect2b" } }] } },
  "fixture.wo12.spell.trigger": { effects: [["effect1", "strike"], ["effect2", "mend"], ["effect3", "hex"]], chain: { failurePolicy: "STOP", nodes: [{ effectKey: "effect1", behavior: "CONTINUE" }, { effectKey: "effect2", behavior: "CONTINUE", trigger: { kind: "NUMERIC_COMPARE", factKey: "chain.effect1.success", operator: "==", expected: 1, provenance: null } }, { effectKey: "effect3", behavior: "STOP" }] } },
  "fixture.wo12.spell.target_fact": { effects: [["effect1", "mend"], ["effect2", "hex"]], chain: { failurePolicy: "STOP", nodes: [{ effectKey: "effect1", behavior: "CONTINUE" }, { effectKey: "effect2", behavior: "STOP", trigger: { kind: "NUMERIC_COMPARE", factKey: "target.bloodied", operator: "==", expected: 1, provenance: null } }] } },
  "fixture.wo12.spell.ruled_default": { effects: [["effect1", "strike"], ["effect2", "mend"]], chain: null },
  "fixture.wo12.spell.multi": { targeting: "spell.targeting.multi_target", targetingParameters: { targetCount: 2 }, effects: [["effect1", "strike"], ["effect2", "mend"]], chain: { failurePolicy: "STOP", nodes: [{ effectKey: "effect1", behavior: "SUCCESS_ONLY" }, { effectKey: "effect2", behavior: "STOP" }] } },
  "fixture.wo12.spell.projectile_attack": { targeting: "spell.targeting.projectile", effects: [["effect1", "strike"], ["effect2", "mend"]], chain: { failurePolicy: "STOP", nodes: [{ effectKey: "effect1", behavior: "CONTINUE" }, { effectKey: "effect2", behavior: "STOP" }] } },
  "fixture.wo12.spell.projectile_save": { targeting: "spell.targeting.projectile", effects: [["effect1", "hex"]], chain: null },
  "fixture.wo12.spell.projectile_auto": { targeting: "spell.targeting.projectile", effects: [["effect1", "mend"]], chain: null },
  "fixture.wo12.spell.target_choice": { effects: [["effect1", "choice"]], chain: null },
  "fixture.wo12.spell.construction_choice": { effects: [["effect1", "construction_choice"]], chain: null },
};

/** Maneuvers per golden (WO12), over the WO11 reference Attacks / Effects and the canonical Martial Save conversions. */
export const DEFAULT_EXECUTION_MANEUVERS: Readonly<Record<string, ManeuverSpec>> = {
  "fixture.wo12.maneuver.crit": { actions: [["attack1", "attack.longsword"], ["attack2", "attack.shield_bash"]], effects: [["effect1", "armor_break", ["attack1"]], ["effect2", "push", ["attack2"]]] },
  "fixture.wo12.maneuver.sweep": { actions: [["attack1", "attack.longsword"]], effects: [["effect1", "maneuver.effect.sweep_attack", ["attack1"]]] },
  "fixture.wo12.maneuver.line": { actions: [["attack1", "attack.longsword"]], effects: [["effect1", "maneuver.effect.line_attack_conversion", ["attack1"]], ["effect2", "knockback", ["attack1"]]] },
};

/** WO2 roll inputs for the neutral Level 3 (d6) roller. */
export const roller = () => characterL3();
export const d6 = (...rolls: number[]) => ({ die: { dieKey: "D6", faces: 6 }, mode: "NORMAL", rolls });
export const attackInput = (executionKey: string, requestKey: string, natural: number, targetDodge = 10) => ({ requestKey, kind: "ATTACK_ROLL", executionKey, roller: roller(), roll: d6(natural), targetDodge });
export const saveInput = (executionKey: string, requestKey: string, natural: number, difficultyClass = 12) => ({ requestKey, kind: "SAVING_THROW", executionKey, roller: roller(), roll: d6(natural), difficultyClass });
export const choiceInput = (executionKey: string, requestKey: string, kind: "SAVE_REMOVAL" | "SAVE_SELECTION", stat: string) => ({ requestKey, kind, executionKey, stat });

export function executionKeyOf(request: Record<string, unknown>): string {
  const plan = compileAbilityExecution(request);
  if (!plan.ok) throw new Error(`execution plan failed: ${JSON.stringify(plan.problems, null, 2)}`);
  return plan.value.executionKey;
}
/** compile + execute; throws on refusal. */
export function runExecution(request: Record<string, unknown>, execution: Record<string, unknown>): AbilityExecutionResult {
  const out = executeAbilityResolution({ ...request, execution });
  if (!out.ok) throw new Error(`execution failed: ${JSON.stringify(out.problems, null, 2)}`);
  return out.value;
}

/** A scripted responder for pending runtime requests (null = no scripted answer). */
export type ExecutionAnswer = (q: import("../ability/effect-execution.js").ExecutionInputRequest) => Record<string, unknown> | null;
/** Execute, answer each newly pending request with the responder, and re-execute until COMPLETE (deterministic resume). */
export function playExecution(request: Record<string, unknown>, targets: Record<string, unknown>[], answer: ExecutionAnswer, extra: Record<string, unknown> = {}) {
  const ek = executionKeyOf(request);
  let inputs: Record<string, unknown>[] = [];
  for (let round = 0; round < 8; round += 1) {
    const r = runExecution(request, { targets, inputs, ...extra });
    if (r.status === "COMPLETE") return { result: r, inputs, executionKey: ek };
    const next = r.pendingInputs.filter((q) => !inputs.some((i) => i.requestKey === q.requestKey));
    if (!next.length) throw new Error(`stuck: ${JSON.stringify(r.pendingInputs)}`);
    for (const q of next) {
      const a = answer(q);
      if (a === null) throw new Error(`no scripted answer for ${q.requestKey}`);
      inputs = [...inputs, { ...a, requestKey: q.requestKey, executionKey: ek }];
    }
  }
  throw new Error("did not complete");
}
