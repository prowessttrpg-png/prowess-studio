import type { CompiledTrait } from "../ability/compile.js";
import type { ProwessDefinitionRef } from "../definition/envelope.js";
import { clonePlainData, deepFreeze } from "../internal/plain-data.js";
import type { SignatureManeuverDraft, SignatureManeuverEvaluation } from "../character/signature-maneuver.js";
import type { SignatureSpellDraft, SignatureSpellEvaluation, SignatureSpellState } from "../character/signature-spell.js";
import {
  CARD_CONTRACT_VERSION,
  available,
  deferred,
  unavailable,
  type CardAbilityIdentity,
  type CardAvailability,
  type CardCostLine,
  type CardCosts,
  type CardLimitation,
  type CardProvenance,
  type CardTraitEntry,
  type CardValue,
  type ManeuverCard,
  type SpellCard,
} from "./contract.js";
import { renderManeuverRules, renderSpellRules, tokenLabel, unavailableInstructions, type LanguageContext } from "./language.js";
import { maneuverRulesOf, spellDeliveryOf, spellRulesOf, type CardRulesModel, type TargetSelectionHook } from "./semantics.js";

/**
 * PAS-10 M6-WO9 — pure Card projections over EXISTING Character Ability evaluations (M6-WO7 Spells, M6-WO8 Maneuvers).
 * Inputs are the evaluation the server already computes (M5 compilers evaluated by M4) plus the exact Ability identity;
 * outputs are read-only Card Presentations. Nothing is recomputed: every cost, range and outcome is copied from the
 * evaluation; what it does not establish is a typed UNAVAILABLE / DEFERRED value.
 */

export interface CardProjectionContext {
  readonly characterId: string;
  readonly characterReleaseId: string;
  readonly identity: CardAbilityIdentity;
  /** Exact-ref labels (the server's names map keyed by entityVersionId); never identity. */
  readonly names: Readonly<Record<string, string>>;
}

const labelFrom = (names: Readonly<Record<string, string>>) => (ref: ProwessDefinitionRef): string => names[ref.entityVersionId] ?? ref.canonicalKey;
const availabilityOf = (state: SignatureSpellState): CardAvailability =>
  state === "VALID" ? "AVAILABLE" : state === "VALID_WITH_RUNTIME_DEFERRED" ? "AVAILABLE_WITH_RUNTIME_DEFERRED" : state === "INCOMPLETE" ? "INCOMPLETE" : "INVALID";
const usable = (state: SignatureSpellState) => state === "VALID" || state === "VALID_WITH_RUNTIME_DEFERRED";
const cardKeyOf = (category: string, identity: CardAbilityIdentity) => `${category}:${identity.abilityId ?? "draft"}:${identity.revisionNumber === null ? "draft" : String(identity.revisionNumber)}`;

function traitEntries(traits: readonly CompiledTrait[]): CardTraitEntry[] {
  return traits.map((t) => ({
    componentKey: t.componentKey,
    trait: t.definition,
    scope: { scope: t.scope.scope, componentKey: t.scope.componentKey },
    modifications: t.modifications.map((m) => {
      const { kind, ...detail } = m.modification as { kind: string } & Record<string, unknown>;
      return { kind, targetComponentKey: m.targetComponentKey, selected: m.selected, detail };
    }),
  }));
}

function provenanceOf(ctx: CardProjectionContext, rulesetProvenance: CardProvenance["rulesetProvenance"], sources: readonly ProwessDefinitionRef[], authority: string, state: string): CardProvenance {
  return { rulesetProvenance, characterReleaseId: ctx.characterReleaseId, characterId: ctx.characterId, ability: ctx.identity, sources, evaluation: { authority, state } };
}

const reasonOf = (e: { readonly issues: readonly { readonly message: string }[]; readonly missing: readonly string[] }, extra: readonly { readonly message: string }[] = []): string =>
  [...extra.map((q) => q.message), ...e.issues.map((q) => q.message)][0] ?? (e.missing.length > 0 ? `not chosen yet: ${e.missing.map((m) => tokenLabel(m)).join(", ")}` : "the Ability is not valid");

/** A Signature Spell card from its M6-WO7 evaluation (current, draft or historical revision). */
export function projectSpellCard(input: { readonly evaluation: SignatureSpellEvaluation; readonly draft: SignatureSpellDraft; readonly context: CardProjectionContext; readonly targetSelection?: TargetSelectionHook | null }): SpellCard {
  const { evaluation: e, draft, context: ctx } = input;
  const lang: LanguageContext = { labelOf: labelFrom(ctx.names) };
  const ok = usable(e.state) && e.cost !== null;
  const why = reasonOf(e, e.costUnresolved);
  const c = e.cost;
  const breakdown: CardCostLine[] =
    c === null || !ok
      ? []
      : [
          ...c.mp.contributions.map((q): CardCostLine => ({ label: `${tokenLabel(q.source)}: ${lang.labelOf(q.definition)}`, currency: "MP", value: q.value, source: q.definition })),
          { label: "Base MP", currency: "MP", value: c.mp.baseMpCost, source: null },
          ...c.percentageContributions.map((q): CardCostLine => ({ label: `${tokenLabel(q.source)}${q.applied ? "" : " (not applied)"}`, currency: "PERCENT", value: q.percent, source: null })),
          { label: "Net percentage", currency: "PERCENT", value: c.netCostPercent, source: null },
          { label: "Final MP", currency: "MP", value: c.finalMpCost, source: null },
          { label: "PRO", currency: "AP", value: c.ap.pro, source: null },
          { label: "Base AP", currency: "AP", value: c.ap.baseApCost, source: null },
          { label: "Final AP", currency: "AP", value: c.ap.finalApCost, source: null },
        ];
  const costs: CardCosts = {
    ap: ok && c !== null ? available(c.ap.finalApCost) : unavailable("CARD.COST_UNRESOLVED", why),
    mp: ok && c !== null ? available(c.finalMpCost) : unavailable("CARD.COST_UNRESOLVED", why),
    breakdown,
  };
  const a = e.authored;
  const targeting: CardValue<SpellCard["targeting"] extends CardValue<infer T> ? T : never> =
    a === null
      ? unavailable("CARD.TARGETING_UNRESOLVED", why)
      : available({
          targeting: draft.targeting?.definition ?? null,
          range: a.targeting.range === null ? unavailable("CARD.RANGE_UNRESOLVED", "the Targeting reports no range") : available({ value: a.targeting.range.value, unit: a.targeting.range.unit, model: a.targeting.range.model, ruleText: a.targeting.range.ruleText }),
          targetCount: { kind: a.targeting.targetCount.kind, count: a.targeting.targetCount.count },
        });
  const deferredFirst = e.runtime.deferred[0];
  let rules: CardValue<CardRulesModel>;
  if (e.chain !== null && a !== null) rules = available(spellRulesOf({ chain: e.chain, delivery: spellDeliveryOf(e.chain), targets: { kind: a.targeting.targetCount.kind, count: a.targeting.targetCount.count }, traits: a.traits, targetSelection: input.targetSelection ?? null }));
  else if (e.state === "VALID_WITH_RUNTIME_DEFERRED" && deferredFirst !== undefined) rules = deferred(deferredFirst.conflictKey, deferredFirst.message);
  else rules = unavailable("CARD.RULES_UNAVAILABLE", why);
  const instructions = rules.status === "AVAILABLE" && rules.value.kind === "SPELL_CHAIN" ? renderSpellRules(rules.value, lang) : unavailableInstructions(rules.status === "DEFERRED" ? rules.conflictKey : "CARD.RULES_UNAVAILABLE", rules.status === "AVAILABLE" ? why : rules.reason);
  const limitations: CardLimitation[] = [...e.runtime.deferred.map((d) => ({ code: d.conflictKey, message: d.message })), ...e.costUnresolved.map((q) => ({ code: "CARD.COST_UNRESOLVED", message: q.message }))];
  const sources = e.components;
  const cardKey = cardKeyOf("SIGNATURE_SPELL", ctx.identity);
  return deepFreeze(
    clonePlainData({
      contractVersion: CARD_CONTRACT_VERSION,
      cardKey,
      category: "SIGNATURE_SPELL" as const,
      name: draft.concept.name,
      description: draft.concept.description,
      artwork: { kind: "PLACEHOLDER" as const },
      availability: availabilityOf(e.state),
      provenance: provenanceOf(ctx, e.rulesetProvenance, sources, "M6-WO7 evaluateCharacterSignatureSpell (M5 construction, M5-WO10 cost, M5-WO12 chain)", e.state),
      costs,
      targeting,
      rules,
      instructions,
      limitations,
      section: {
        kind: "SIGNATURE_SPELL" as const,
        authority: draft.authority,
        affinity: draft.affinity,
        keywords: e.keywords,
        duration: draft.duration?.definition ?? null,
        castingConditions: draft.castingConditions.map((q) => q.definition),
        traits: a === null ? [] : traitEntries(a.traits),
        runtime: {
          sustain: e.runtime.sustain === null ? null : available(e.runtime.sustain),
          manaLock: e.runtime.manaLock === null ? null : deferred<never>(e.runtime.manaLock.conflictKey, "no exact Mana Lock reservation amount is authored"),
          concentration: e.runtime.concentration,
        },
      },
      snapshot: { contractVersion: CARD_CONTRACT_VERSION, cardKey, rulesetProvenance: e.rulesetProvenance, characterReleaseId: ctx.characterReleaseId, ability: ctx.identity, sources: sources.map((s) => s.entityVersionId) },
    }),
  ) as SpellCard;
}

/** The exact Action source: a Foundation Definition, or the exact WO6 Weapon + Attack pair (discriminated by kind). */
function actionSourceOf(source: SignatureManeuverDraft["actions"][number]["source"]): { source: ProwessDefinitionRef; weapon: ProwessDefinitionRef | null; attackKey: string | null } {
  if (source.kind === "FOUNDATION") return { source: source.definition, weapon: null, attackKey: null };
  const { weapon, attack, attackKey } = source;
  return { source: attack, weapon, attackKey };
}

/** A Signature Maneuver card from its M6-WO8 evaluation — independent resolution groups, never one Spell chain. */
export function projectManeuverCard(input: { readonly evaluation: SignatureManeuverEvaluation; readonly draft: SignatureManeuverDraft; readonly context: CardProjectionContext; readonly performance?: Readonly<Record<string, unknown>> | null }): ManeuverCard {
  const { evaluation: e, draft, context: ctx } = input;
  const label = labelFrom(ctx.names);
  const actionLabel = (key: string): string => {
    const use = draft.actions.find((x) => x.componentKey === key);
    if (use === undefined) return key;
    return use.source.kind === "FOUNDATION" ? label(use.source.definition) : label(use.source.attack);
  };
  const lang: LanguageContext = { labelOf: label, actionLabel };
  const ok = usable(e.state) && e.cost !== null;
  const why = reasonOf(e, e.runtimeDeferred);
  const c = e.cost;
  const breakdown: CardCostLine[] =
    c === null || !ok
      ? []
      : [
          ...c.ap.contributions.map((q): CardCostLine => ({ label: `${tokenLabel(q.source)}: ${label(q.definition)}`, currency: "AP", value: q.value, source: q.definition })),
          { label: "Base AP", currency: "AP", value: c.ap.baseApCost, source: null },
          ...(c.ap.protectedActionAp === undefined ? [] : [{ label: "Protected Action AP", currency: "AP" as const, value: c.ap.protectedActionAp, source: null }]),
          { label: "After Conditions", currency: "AP", value: c.ap.postConditionApCost, source: null },
          ...(c.ap.signature.applied ? [{ label: "Signature reduction", currency: "AP" as const, value: c.ap.signature.reduction, source: null }] : []),
          { label: "Final AP", currency: "AP", value: c.ap.finalApCost, source: null },
          ...c.mp.contributions.map((q): CardCostLine => ({ label: `${tokenLabel(q.source)}: ${label(q.definition)}`, currency: "MP", value: q.value, source: q.definition })),
          { label: "Base MP", currency: "MP", value: c.mp.baseMpCost, source: null },
          { label: "Final MP", currency: "MP", value: c.mp.finalMpCost, source: null },
        ];
  const costs: CardCosts = {
    ap: ok && c !== null ? available(c.ap.finalApCost) : unavailable("CARD.COST_UNRESOLVED", why),
    mp: ok && c !== null ? available(c.mp.finalMpCost) : unavailable("CARD.COST_UNRESOLVED", why),
    breakdown,
  };
  const a = e.authored;
  const deferredFirst = e.runtimeDeferred[0];
  let rules: CardValue<CardRulesModel>;
  // Only a usable (VALID / runtime-deferred) Maneuver presents its groups; an invalid one is never a usable reference.
  if (usable(e.state) && e.execution !== null && a !== null) rules = available(maneuverRulesOf({ groups: e.execution.groups, traits: a.traits }));
  else if (e.state === "VALID_WITH_RUNTIME_DEFERRED" && deferredFirst !== undefined) rules = deferred(deferredFirst.code, deferredFirst.message);
  else rules = unavailable("CARD.RULES_UNAVAILABLE", why);
  const instructions = rules.status === "AVAILABLE" && rules.value.kind === "MANEUVER_GROUPS" ? renderManeuverRules(rules.value, lang) : unavailableInstructions(rules.status === "DEFERRED" ? rules.conflictKey : "CARD.RULES_UNAVAILABLE", rules.status === "AVAILABLE" ? why : rules.reason);
  const targeting =
    a === null
      ? unavailable<never>("CARD.TARGETING_UNRESOLVED", why)
      : available({
          targeting: null,
          range: a.targeting.range === null ? unavailable<never>("CARD.RANGE_UNRESOLVED", "the Targeting reports no range") : available({ value: a.targeting.range.value, unit: a.targeting.range.unit, model: a.targeting.range.model, ruleText: a.targeting.range.ruleText }),
          targetCount: { kind: a.targeting.targetCount.kind, count: a.targeting.targetCount.count },
        });
  const sources = e.components;
  const cardKey = cardKeyOf("SIGNATURE_MANEUVER", ctx.identity);
  return deepFreeze(
    clonePlainData({
      contractVersion: CARD_CONTRACT_VERSION,
      cardKey,
      category: "SIGNATURE_MANEUVER" as const,
      name: draft.concept.name,
      description: draft.concept.description,
      artwork: { kind: "PLACEHOLDER" as const },
      availability: availabilityOf(e.state),
      provenance: provenanceOf(ctx, e.rulesetProvenance, sources, "M6-WO8 evaluateCharacterSignatureManeuver (M5 construction, Maneuver cost, M5-WO12 groups)", e.state),
      costs,
      targeting,
      rules,
      instructions,
      limitations: e.runtimeDeferred.map((d) => ({ code: d.code, message: d.message })),
      section: {
        kind: "SIGNATURE_MANEUVER" as const,
        actions: draft.actions.map((x) => ({ actionKey: x.componentKey, order: x.order, ...actionSourceOf(x.source) })),
        duration: draft.duration?.definition ?? null,
        conditions: draft.conditions.map((q) => q.definition),
        traits: a === null ? [] : traitEntries(a.traits),
        performance: input.performance === undefined || input.performance === null ? null : available(input.performance),
      },
      snapshot: { contractVersion: CARD_CONTRACT_VERSION, cardKey, rulesetProvenance: e.rulesetProvenance, characterReleaseId: ctx.characterReleaseId, ability: ctx.identity, sources: sources.map((s) => s.entityVersionId) },
    }),
  ) as ManeuverCard;
}
