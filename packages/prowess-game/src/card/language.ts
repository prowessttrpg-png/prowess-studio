import type { ProwessDefinitionRef } from "../definition/envelope.js";
import type { SaveFlow } from "../ability/effect-execution.js";
import type {
  ActionCostSemantics,
  AttackCheckSemantics,
  AttackOutcomeSemantics,
  AttackPropertySemantics,
  AttackRules,
  CardRulesModel,
  GeneralActionRules,
  ChainStepSemantics,
  CheckSemantics,
  ConditionSemantics,
  GroupEffectSemantics,
  ManeuverGroupRules,
  NextSemantics,
  OperationSemantics,
  OutcomeSemantics,
  ResolutionGroupSemantics,
  SpellChainRules,
  UnresolvedSemantics,
} from "./semantics.js";
import { deepFreeze } from "../internal/plain-data.js";

/**
 * PAS-10 M6-WO9 — the Prowess Card Rules Language: deterministic English templates over the typed semantic model
 * (semantics.ts). It renders only what the model states. Wording is assembled in three layers: phrases (semantic →
 * clause), sentences (punctuation) and blocks (layout keys) — so localization and layout never touch semantics.
 * No fact comes from a name, a description or narrative intent; an undescribable part is rendered as an explicit
 * unresolved note pointing to the Rules Inspector (fail closed).
 */

export type InstructionBlockKind = "TARGETS" | "DELIVERY" | "STEP" | "GROUP" | "UNRESOLVED" | "NOTE";
export interface InstructionBlock {
  readonly key: string;
  readonly kind: InstructionBlockKind;
  readonly text: string;
  /** The Effect / group keys the block speaks about (for screen-reader order and Inspector links). */
  readonly refs: readonly string[];
}
export interface CardInstructions {
  readonly language: "en";
  readonly status: "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
  readonly blocks: readonly InstructionBlock[];
  readonly unresolved: readonly UnresolvedSemantics[];
}
export interface LanguageContext {
  /** Exact-ref label lookup (the server's names map keyed by entityVersionId); never used as identity. */
  readonly labelOf: (ref: ProwessDefinitionRef) => string;
  /** Maneuver Action label by Action key (its exact Weapon Attack / Foundation). */
  readonly actionLabel?: (actionKey: string) => string;
}

// ---- phrase layer ---------------------------------------------------------------------------------------------------

/** "DEFENDER_CHOOSES" → "Defender Chooses" (presentation of a vocabulary token). */
export function tokenLabel(token: string): string {
  return token
    .split(/[_.\s]+/)
    .filter((w) => w !== "")
    .map((w) => `${w.charAt(0).toUpperCase()}${w.slice(1).toLowerCase()}`)
    .join(" ");
}
const valueText = (v: unknown): string => (typeof v === "string" ? tokenLabel(v) : typeof v === "number" || typeof v === "boolean" ? String(v) : v === null ? "none" : JSON.stringify(v));
const listOr = (items: readonly string[]): string => (items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`);
const listAnd = (items: readonly string[]): string => (items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

const factValue = (op: OperationSemantics, key: string): unknown => op.facts.find((f) => f.key === key)?.value;
const restFacts = (op: OperationSemantics, used: readonly string[]): string => {
  const rest = op.facts.filter((f) => !used.includes(f.key));
  return rest.length === 0 ? "" : ` (${rest.map((f) => `${tokenLabel(f.key)}: ${valueText(f.value)}`).join("; ")})`;
};
const dice = (n: unknown): string => (n === 1 ? "1 Character Die" : `${valueText(n)} Character Dice`);

/** One authored outcome operation, worded from its kind and its evaluated / authored facts only. */
export function operationPhrase(op: OperationSemantics, ctx: LanguageContext): string {
  const missing = op.missingParameters.length === 0 ? "" : ` [unresolved parameter: ${op.missingParameters.join(", ")}]`;
  switch (op.kind) {
    case "NO_EFFECT":
      return `nothing happens${restFacts(op, [])}`;
    case "DAMAGE": {
      const n = factValue(op, "dice");
      const type = factValue(op, "damageType");
      const body = n === undefined ? "deal damage" : `deal ${dice(n)} of ${type === undefined ? "" : `${valueText(type)} `}damage`;
      return `${body}${restFacts(op, ["dice", "damageType"])}${missing}`;
    }
    case "HEAL": {
      const n = factValue(op, "dice");
      return `${n === undefined ? "heal" : `heal ${dice(n)}`}${restFacts(op, ["dice"])}${missing}`;
    }
    case "CLEANSE": {
      const c = factValue(op, "category");
      return `${c === undefined ? "cleanse" : `cleanse ${valueText(c)}`}${restFacts(op, ["category"])}${missing}`;
    }
    case "MODIFY_VALUE": {
      const dir = factValue(op, "direction");
      const target = factValue(op, "target");
      const amount = factValue(op, "amount");
      return `${dir === undefined ? "modify" : valueText(dir).toLowerCase()} ${target === undefined ? "a value" : valueText(target)}${amount === undefined ? "" : ` by ${valueText(amount)}`}${restFacts(op, ["direction", "target", "amount"])}${missing}`;
    }
    case "CONTROL": {
      const control = factValue(op, "control");
      return `${control === undefined ? "control" : valueText(control).toLowerCase()} the target${restFacts(op, ["control"])}${missing}`;
    }
    case "UTILITY": {
      const fn = factValue(op, "function");
      return `${fn === undefined ? "utility" : valueText(fn).toLowerCase()}${restFacts(op, ["function"])}${missing}`;
    }
    case "SUMMON":
      return `summon${restFacts(op, [])} — structural contract only; its runtime is deferred${missing}`;
    case "FOUNDATION_DAMAGE": {
      const f = factValue(op, "fraction");
      const body = f === 1 ? "deal the Attack's full damage" : f === 0.5 ? "deal half of the Attack's damage" : f === undefined ? "deal the Attack's damage" : `deal the Attack's damage × ${valueText(f)}`;
      return `${body}${restFacts(op, ["fraction"])}${missing}`;
    }
    case "CONVERT_TARGETING": {
      const d = factValue(op, "destination");
      return `convert the targeting${d === undefined ? "" : ` to ${valueText(d)}`}${restFacts(op, ["destination"])}${missing}`;
    }
    case "CONVERT_DAMAGE_TYPE": {
      const t = factValue(op, "damageType");
      return `${t === undefined ? "convert the damage type" : `change the damage type to ${valueText(t)}`}${restFacts(op, ["damageType"])}${missing}`;
    }
    default:
      void ctx;
      return `${tokenLabel(op.kind).toLowerCase()}${restFacts(op, [])}${missing}`;
  }
}

export function outcomePhrase(o: OutcomeSemantics, ctx: LanguageContext): string {
  if (!o.authored) return "no outcome is authored";
  if (o.operations.length === 0) return "no operation is authored";
  return listAnd(o.operations.map((op) => operationPhrase(op, ctx)));
}

/** The defender's Saving Throw, worded from the exact Save flow (who chooses / removes). */
export function savingThrowPhrase(flow: SaveFlow): string {
  switch (flow.kind) {
    case "FIXED":
      return `the target makes a ${flow.stat} Saving Throw`;
    case "DEFENDER_CHOOSES":
      return `the target makes a Saving Throw, choosing ${listOr(flow.stats)}`;
    case "ATTACKER_REMOVES_ONE":
      return `the target makes a Saving Throw from ${listAnd(flow.stats)} after you remove one of those options`;
    case "ATTACKER_CHOOSES":
      return `the target makes the Saving Throw you choose from ${listOr(flow.stats)}`;
  }
}

const positionOf = (positions: ReadonlyMap<string, string>, key: string) => `Effect ${positions.get(key) ?? key}`;

const OPERATOR_WORDS: Readonly<Record<string, string>> = { "==": "is", "!=": "is not", ">=": "is at least", "<=": "is at most", ">": "is more than", "<": "is less than" };
export function conditionPhrase(c: ConditionSemantics, positions: ReadonlyMap<string, string>): string {
  switch (c.kind) {
    case "EFFECT_RESULT":
      return `${positionOf(positions, c.effectKey)} ${c.negated ? (c.result === "SUCCEEDED" ? "did not succeed" : "did not fail") : c.result === "SUCCEEDED" ? "succeeded" : "failed"}`;
    case "PREVIOUS_RESULT":
      return `the previous Effect ${c.negated ? (c.result === "SUCCEEDED" ? "did not succeed" : "did not fail") : c.result === "SUCCEEDED" ? "succeeded" : "failed"}`;
    case "DELIVERY":
      return c.fact === "HIT" ? `the delivery Attack Roll ${c.negated ? "missed" : "hit"}` : `the delivery Attack Roll ${c.negated ? "was not" : "was"} a critical hit`;
    case "TARGET_FACT":
      return `the target's ${tokenLabel(c.factKey.split(".").slice(1).join("."))} ${OPERATOR_WORDS[c.operator] ?? c.operator} ${c.expected}`;
    case "ALL":
      return listAnd(c.children.map((x) => conditionPhrase(x, positions)));
    case "ANY":
      return listOr(c.children.map((x) => conditionPhrase(x, positions)));
    case "NONE":
      return `none of these holds: ${c.children.map((x) => conditionPhrase(x, positions)).join("; ")}`;
    case "UNDESCRIBED":
      return "a condition this card cannot word faithfully (see the Rules Inspector)";
  }
}

const nextPhrase = (n: NextSemantics, positions: ReadonlyMap<string, string>, ender: string): string => (n.kind === "EFFECT" ? `continue to ${positionOf(positions, n.effectKey)}` : ender);

// ---- sentence layer -------------------------------------------------------------------------------------------------

/** Capitalizes the first letter and ends the sentence once. */
export function sentence(clause: string): string {
  const t = clause.trim();
  if (t === "") return "";
  const body = `${t.charAt(0).toUpperCase()}${t.slice(1)}`;
  return /[.!?]$/.test(body) ? body : `${body}.`;
}

function checkSentences(check: CheckSemantics, step: { onEffectSuccess: OutcomeSemantics; onEffectFailure: OutcomeSemantics }, ctx: LanguageContext, group: ResolutionGroupSemantics | null): string[] {
  const success = outcomePhrase(step.onEffectSuccess, ctx);
  const failure = outcomePhrase(step.onEffectFailure, ctx);
  switch (check.kind) {
    case "ATTACK_ROLL":
      return check.reusesDelivery
        ? [sentence(`this Effect uses the delivery Attack Roll: on a hit, ${success}; on a miss, ${failure}`)]
        : [sentence("make an Attack Roll against the target"), sentence(`on a hit, ${success}`), sentence(`on a miss, ${failure}`)];
    case "SAVING_THROW":
      return [sentence(savingThrowPhrase(check.flow)), sentence(`if the save fails, the Effect succeeds: ${success}`), sentence(`if the save succeeds, the Effect fails: ${failure}`)];
    case "AUTOMATIC":
      return [sentence(`no roll — it applies automatically: ${success}`)];
    case "GROUP":
      if (group === null || group.check.kind === "NONE") return [sentence(`resolves with its Action group: on success, ${success}; on failure, ${failure}`)];
      return group.check.kind === "ATTACK_ROLL" ? [sentence(`on the group's hit, ${success}; on its miss, ${failure}`)] : [sentence(`if the group's save fails, the Effect succeeds: ${success}`), sentence(`if it succeeds, the Effect fails: ${failure}`)];
    case "UNRESOLVED":
      return [sentence(`its resolution is unresolved (${check.code}: ${check.reason}) — see the Rules Inspector`)];
  }
}

function transitionSentence(s: ChainStepSemantics, positions: ReadonlyMap<string, string>): string {
  const ends = "the Spell ends for this target";
  const source = s.behaviorSource === "RULED_DEFAULT" ? " (ruled default)" : "";
  switch (s.behavior) {
    case "STOP":
      return sentence(`then ${ends}${source}`);
    case "SUCCESS_ONLY":
      return sentence(`if this Effect succeeds, ${nextPhrase(s.afterSuccess, positions, ends)}; if it fails, ${ends}${source}`);
    case "FAILURE_ONLY":
      return sentence(`if this Effect fails, ${nextPhrase(s.afterFailure, positions, ends)}; if it succeeds, ${ends}${source}`);
    case "BRANCH":
      return sentence(`if this Effect succeeds, go to ${s.afterSuccess.kind === "EFFECT" ? positionOf(positions, s.afterSuccess.effectKey) : "the end"}; if it fails, go to ${s.afterFailure.kind === "EFFECT" ? positionOf(positions, s.afterFailure.effectKey) : "the end"}${source}`);
    default:
      return sentence(`then, whatever the result, ${nextPhrase(s.afterSuccess, positions, ends)}${source}`);
  }
}

// ---- block layer ----------------------------------------------------------------------------------------------------

function targetSentences(rules: SpellChainRules, ctx: LanguageContext): string[] {
  const t = rules.targets;
  const out = [t.kind === "ONE" ? sentence("choose one target") : t.count !== null ? sentence(`choose ${t.count} ${t.count === 1 ? "target" : "targets"}`) : sentence(`targets: ${tokenLabel(t.kind)}`)];
  if (t.selection !== null) out.push(sentence(`${ctx.labelOf(t.selection.source)}: within the area, only creatures you select are affected`));
  const verbs: Readonly<Record<string, string>> = { ADD: "increases", MULTIPLY: "multiplies", SET: "sets" };
  for (const m of t.measureChanges) out.push(sentence(`${ctx.labelOf(m.trait)} ${verbs[m.operation] ?? tokenLabel(m.operation).toLowerCase()} the ${tokenLabel(m.measure).toLowerCase()} (${valueText(m.selected)})`));
  if (t.kind !== "ONE") out.push(sentence("resolve the chain below separately for each target"));
  return out;
}

export function renderSpellRules(rules: SpellChainRules, ctx: LanguageContext): CardInstructions {
  const positions = new Map(rules.steps.map((s) => [s.effectKey, s.position]));
  const blocks: InstructionBlock[] = [{ key: "targets", kind: "TARGETS", text: targetSentences(rules, ctx).join(" "), refs: [] }];
  if (rules.delivery !== null) {
    const reused = rules.delivery.reusedBy.length > 0 ? `${listAnd(rules.delivery.reusedBy.map((k) => positionOf(positions, k)))} ${rules.delivery.reusedBy.length === 1 ? "uses" : "use"} this roll and fails on a miss; ` : "";
    blocks.push({ key: "delivery", kind: "DELIVERY", text: [sentence("make a ranged Attack Roll to deliver the Spell to the target"), sentence(`on a miss, ${reused}every other Effect is not delivered — not a failure — and the chain ends for that target`)].join(" "), refs: rules.delivery.reusedBy });
  }
  for (const s of rules.steps) {
    const parts = [sentence(`${positionOf(positions, s.effectKey)} — ${ctx.labelOf(s.effect)} (${tokenLabel(s.family)})${s.branchDestination ? ", reached only by a branch" : ""}`)];
    if (s.trigger !== null && s.notTriggered !== null) parts.push(sentence(`only if ${conditionPhrase(s.trigger, positions)}; otherwise it is not triggered — not a failure — and the chain ${s.notTriggered.kind === "EFFECT" ? `moves on to ${positionOf(positions, s.notTriggered.effectKey)}` : "ends for this target"}`));
    parts.push(...checkSentences(s.check, s, ctx, null));
    if (s.checkSetBy !== null) parts.push(sentence(`(resolution set by ${ctx.labelOf(s.checkSetBy)})`));
    parts.push(transitionSentence(s, positions));
    if (s.traits.length > 0) parts.push(sentence(`traits: ${s.traits.map((t) => ctx.labelOf(t)).join(", ")}`));
    blocks.push({ key: `step.${s.effectKey}`, kind: "STEP", text: parts.join(" "), refs: [s.effectKey] });
  }
  return finish(blocks, rules.unresolved);
}

function groupEffectSentence(e: GroupEffectSemantics, g: ResolutionGroupSemantics, ctx: LanguageContext): string {
  return [sentence(`${ctx.labelOf(e.effect)} (${tokenLabel(e.family)})`), ...checkSentences(e.check, e, ctx, g), ...(e.traits.length > 0 ? [sentence(`traits: ${e.traits.map((t) => ctx.labelOf(t)).join(", ")}`)] : [])].join(" ");
}

const replacingLabel = (g: ResolutionGroupSemantics, effectKey: string, ctx: LanguageContext): string => {
  const e = g.effects.find((x) => x.effectKey === effectKey);
  return e === undefined ? effectKey : ctx.labelOf(e.effect);
};

export function renderManeuverRules(rules: ManeuverGroupRules, ctx: LanguageContext): CardInstructions {
  const action = ctx.actionLabel ?? ((k: string) => k);
  const blocks: InstructionBlock[] = [{ key: "groups", kind: "NOTE", text: sentence("resolve each Action group separately — each has its own resolution; Maneuver Actions never form one Spell Effect Chain"), refs: [] }];
  for (const g of rules.groups) {
    const head =
      g.kind === "POWERFUL_BLOW"
        ? sentence(`action group ${g.position} — Powerful Blow: ${g.actionKeys.length} Attacks (${listAnd(g.actionKeys.map(action))}) resolve together with one roll`)
        : sentence(`action group ${g.position} — ${listAnd(g.actionKeys.map(action))}`);
    const check =
      g.check.kind === "ATTACK_ROLL"
        ? sentence("make one Attack Roll against the target")
        : g.check.kind === "SAVING_THROW"
          ? sentence(`instead of an Attack Roll, ${savingThrowPhrase(g.check.flow)} (set by ${replacingLabel(g, g.check.replacedBy, ctx)})`)
          : sentence("no roll: this Action does not attack");
    const limit = g.targetLimit === null ? sentence("its attached targeting conversion sets the targets") : sentence(g.targetLimit === 1 ? "one target" : `${g.targetLimit} targets`);
    const effects = g.effects.length === 0 ? [sentence("no Effect is attached")] : g.effects.map((e) => groupEffectSentence(e, g, ctx));
    blocks.push({ key: `group.${g.groupKey}`, kind: "GROUP", text: [head, check, limit, ...effects].join(" "), refs: [g.groupKey, ...g.effects.map((e) => e.effectKey)] });
  }
  return finish(blocks, rules.unresolved);
}

function finish(blocks: InstructionBlock[], unresolved: readonly UnresolvedSemantics[]): CardInstructions {
  const notes = unresolved.map((u, i): InstructionBlock => ({ key: `unresolved.${i}`, kind: "UNRESOLVED", text: sentence(`unresolved (${u.code}): ${u.message} — see the Rules Inspector`), refs: [] }));
  return deepFreeze({ language: "en" as const, status: unresolved.length === 0 ? ("COMPLETE" as const) : ("PARTIAL" as const), blocks: [...blocks, ...notes], unresolved: [...unresolved] });
}

// ---- Phase B: Weapon Attacks ------------------------------------------------------------------------------------------

const ATTACK_OUTCOME_WORDS: Readonly<Record<AttackOutcomeSemantics, string>> = { FULL: "full damage", HALF: "half damage", NO_DAMAGE: "no damage" };
const PROPERTY_STATUS_WORDS: Readonly<Record<string, string>> = { EXECUTABLE: "applied", REFERENCE_ONLY: "reference only — not executed", DEFERRED: "deferred — not executed" };

/** The defender's save is named explicitly; the authored outcome follows each side (decision C4). */
export function attackCheckSentences(check: AttackCheckSemantics): string[] {
  switch (check.kind) {
    case "ATTACK_ROLL":
      return [sentence("make an Attack Roll against the target"), sentence("on a hit, deal the selected damage"), sentence(`on a miss, ${ATTACK_OUTCOME_WORDS[check.onMiss]}`)];
    case "SAVING_THROW":
      return [
        sentence(`the target makes a ${check.stat} Saving Throw against ${check.dc === "ATTACKER_CHARACTER_DC" ? "your Character DC" : tokenLabel(check.dc)}`),
        sentence(`if the target's save fails, ${ATTACK_OUTCOME_WORDS[check.onDefenderSaveFails]}`),
        sentence(`if the target's save succeeds, ${ATTACK_OUTCOME_WORDS[check.onDefenderSaveSucceeds]}`),
      ];
    case "UNRESOLVED":
      return [sentence(`how this Attack resolves is not stated (${check.code}: ${check.reason}); it is shown, never resolved`)];
  }
}

export function propertyPhrase(p: AttackPropertySemantics, ctx: LanguageContext): string {
  return `${ctx.labelOf(p.trait)} (${PROPERTY_STATUS_WORDS[p.executionStatus] ?? tokenLabel(p.executionStatus)})${p.summary === "" ? "" : `: ${p.summary}`}`;
}

export function renderAttackRules(rules: AttackRules, ctx: LanguageContext): CardInstructions {
  const blocks: InstructionBlock[] = [{ key: "attack.resolution", kind: "STEP", text: attackCheckSentences(rules.check).join(" "), refs: [] }];
  const damage = rules.damage.map((d) => `${d.expression ?? "unresolved"} ${tokenLabel(d.damageType)}`);
  if (damage.length > 0) blocks.push({ key: "attack.damage", kind: "STEP", text: sentence(damage.length === 1 ? `damage: ${damage[0]}` : `damage — choose one profile: ${listOr(damage)}`), refs: rules.damage.map((d) => d.profileKey) });
  rules.properties.forEach((p, i) => blocks.push({ key: `attack.property.${i}`, kind: "NOTE", text: sentence(propertyPhrase(p, ctx)), refs: [p.traitKey] }));
  return finish(blocks, rules.unresolved);
}

// ---- Phase B: General Actions -----------------------------------------------------------------------------------------

export function actionCostPhrase(cost: ActionCostSemantics): string {
  switch (cost.model) {
    case "FIXED":
      return `costs ${cost.amount} AP`;
    case "MINIMUM":
      return `costs at least ${cost.minimum} AP`;
    case "RANGE":
      return `costs ${cost.minimum} to ${cost.maximum} AP — you choose within that range`;
    case "VARIABLE":
      return `its AP cost is set by the ${tokenLabel(cost.determinedBy)} it is used for`;
    case "NONE":
      return "costs no AP";
  }
}

export function renderGeneralActionRules(rules: GeneralActionRules, ctx: LanguageContext): CardInstructions {
  const when = rules.timing === "OWN_TURN" ? "use it on your turn" : rules.timing === "OUTSIDE_OWN_TURN" ? "use it outside your turn" : `timing: ${tokenLabel(rules.timing)}`;
  const trigger = rules.requiresTrigger ? ", only in response to its trigger" : "";
  const others = rules.otherCosts.map((c) => `${c.amount} ${tokenLabel(c.costKey)}`);
  const blocks: InstructionBlock[] = [
    { key: "action.use", kind: "STEP", text: [sentence(`${when}${trigger}`), sentence(`${actionCostPhrase(rules.cost)}${others.length === 0 ? "" : `; it also spends ${listAnd(others)}`}`)].join(" "), refs: [] },
  ];
  if (rules.movementGrant !== null) {
    const g = rules.movementGrant;
    const inputs = g.inputs.filter((x) => x.current !== null).map((x) => `${tokenLabel(x.statistic ?? x.variable)} is ${x.current}${x.unit === null ? "" : ` ${x.unit}`}`);
    blocks.push({ key: "action.movement", kind: "STEP", text: [sentence(`grants Movement by its formula (${g.expression}${g.unit === null ? "" : `, in ${g.unit}`}), worked out when the Action is taken`), inputs.length === 0 ? "" : sentence(`your ${listAnd(inputs)} now`)].filter((t) => t !== "").join(" "), refs: [] });
  }
  for (const imp of rules.improvements) {
    const parts = imp.modifications
      .filter((m) => m.support !== "UNSUPPORTED")
      .map((m) => {
        const cost = m.actionPointCost === null ? "" : `it costs ${m.actionPointCost} AP instead; `;
        return m.condition === null ? `${cost}${m.rulesText}` : `when ${conditionPhrase(m.condition, new Map())}: ${cost}${m.rulesText}`;
      });
    blocks.push({ key: `action.improvement.${imp.improvementKey}`, kind: "NOTE", text: [sentence(`${ctx.labelOf(imp.improvement)} (${tokenLabel(imp.status)})`), ...parts.map(sentence)].join(" "), refs: [imp.improvementKey] });
  }
  return finish(blocks, rules.unresolved);
}

export function renderCardRules(rules: CardRulesModel, ctx: LanguageContext): CardInstructions {
  switch (rules.kind) {
    case "SPELL_CHAIN":
      return renderSpellRules(rules, ctx);
    case "MANEUVER_GROUPS":
      return renderManeuverRules(rules, ctx);
    case "WEAPON_ATTACK":
      return renderAttackRules(rules, ctx);
    case "GENERAL_ACTION":
      return renderGeneralActionRules(rules, ctx);
  }
}

/** Instructions when no rules model exists (an invalid / incomplete Ability or an undelivered domain). */
export function unavailableInstructions(code: string, message: string): CardInstructions {
  return deepFreeze({ language: "en" as const, status: "UNAVAILABLE" as const, blocks: [{ key: "unavailable", kind: "UNRESOLVED" as const, text: sentence(`no instructions: ${message}`), refs: [] }], unresolved: [{ code, message }] });
}
