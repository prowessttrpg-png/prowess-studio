import type { ProwessDefinitionBundle } from "../bundle/bundle.js";
import type { CharacterMechanicalProfile } from "../character/advancement.js";
import { actionImprovementsFor, evaluateActionImprovement, type ActionImprovementEvaluation } from "../character/action-improvement.js";
import type { CoreEntry } from "../core/definitions.js";
import type { ActionImprovementPayload } from "../definition/action-improvement-payload.js";
import type { ProwessDefinitionRef } from "../definition/envelope.js";
import type { ActionDefinitionPayload } from "../definition/runtime-payload.js";
import { clonePlainData, deepFreeze } from "../internal/plain-data.js";
import { indexRuntimeDefinitions } from "../runtime/definitions.js";
import {
  CARD_CONTRACT_VERSION,
  available,
  deferred,
  unavailable,
  type CardCostLine,
  type CardImprovementEntry,
  type CardLimitation,
  type CardValue,
  type GeneralActionCard,
  type GeneralActionCardSection,
} from "./contract.js";
import type { CharacterCardContext } from "./equipment.js";
import { renderGeneralActionRules, type LanguageContext } from "./language.js";
import { conditionOf, type GeneralActionRules } from "./semantics.js";

/**
 * PAS-10 M6-WO9 Phase B — General Action Cards and the Action Directory: Release-driven projections of the EXISTING
 * ACTION Definitions (M5-WO3) the Character's Release pins, read through the M5 runtime role index. A card restates the
 * ACTION's authored timing, trigger, AP-cost model, other costs and movement grant; the grant itself is evaluated by
 * the runtime when the Action is taken (DEFERRED here) — its inputs show the Character's CURRENT derived values.
 *
 * ACTION Definitions author no Character prerequisites, so eligibility is NO_REQUIREMENTS: no prerequisite rule is
 * invented for an existing Action. Action Improvements (ACTION_IMPROVEMENT) attach by exact parent reference and are
 * evaluated by character/action-improvement.ts; an ACTIVE, unconditional explicit AP cost replaces a FIXED cost exactly
 * as the ACTION contract's own explicit-rule override does. Nothing is spent, executed or persisted.
 */

const AUTHORITY = "M5-WO3 ACTION Definition (runtime role index) · M6-WO4 Character profile · M6-WO9 ACTION_IMPROVEMENT evaluation";
const labelFrom = (names: Readonly<Record<string, string>>) => (ref: ProwessDefinitionRef): string => names[ref.entityVersionId] ?? ref.canonicalKey;
export const generalActionCardKey = (action: ProwessDefinitionRef): string => `GENERAL_ACTION:${action.entityVersionId}`;

const improvementEntry = (e: ActionImprovementEvaluation): CardImprovementEntry => ({
  improvement: e.improvement,
  improvementKey: e.improvementKey,
  status: e.status,
  eligibility: e.eligibility.status,
  applicability: e.applicability.status,
  rulesText: e.rulesText,
  prerequisites: e.eligibility.prerequisites.map((q) => ({ prerequisiteKey: q.prerequisiteKey, kind: q.kind, satisfied: q.satisfied, progression: q.progression, reason: q.reason })),
  modifications: e.applicability.modifications.map((m) => ({ modificationKey: m.modificationKey, kind: m.kind, support: m.support, conditional: m.condition !== null, reason: m.reason })),
  reasons: e.reasons,
});

/** The AP cost of the Action now: its authored model, replaced by exactly one ACTIVE unconditional explicit override. */
function costsOf(entry: CoreEntry<ActionDefinitionPayload>, improvements: readonly ActionImprovementEvaluation[]): { ap: CardValue<number>; breakdown: CardCostLine[]; limitations: CardLimitation[] } {
  const c = entry.payload.actionPointCost;
  const overrides = improvements
    .filter((e) => e.status === "ACTIVE")
    .flatMap((e) => e.applicability.modifications.filter((m) => m.support === "APPLIED" && m.condition === null && m.actionPointCost !== null).map((m) => ({ source: e.improvement, amount: m.actionPointCost?.amount as number })));
  if (c.model === "FIXED") {
    const breakdown: CardCostLine[] = [{ label: "Action", currency: "AP", value: c.amount, source: entry.ref }];
    if (overrides.length === 0) return { ap: available(c.amount), breakdown, limitations: [] };
    if (overrides.length > 1) return { ap: unavailable("ACTION.COST_OVERRIDE_CONFLICT", "more than one active improvement sets this Action's AP cost; no winner is chosen"), breakdown, limitations: [{ code: "ACTION.COST_OVERRIDE_CONFLICT", message: overrides.map((o) => o.source.canonicalKey).join(", ") }] };
    const only = overrides[0] as { source: ProwessDefinitionRef; amount: number };
    return { ap: available(only.amount), breakdown: [...breakdown, { label: "Improvement (explicit cost)", currency: "AP", value: only.amount, source: only.source }], limitations: [] };
  }
  if (c.model === "NONE") return { ap: available(0), breakdown: [], limitations: [] };
  if (c.model === "VARIABLE") return { ap: unavailable("ACTION.COST_SET_BY_SOURCE", `the AP cost is set by the ${c.determinedBy.toLowerCase().replace(/_/g, " ")} it is used for`), breakdown: [], limitations: [] };
  return { ap: unavailable("ACTION.COST_CHOSEN_AT_USE", c.model === "RANGE" ? `the AP cost is chosen from ${c.minimum} to ${c.maximum} when the Action is used` : `the AP cost is at least ${c.minimum}, chosen when the Action is used`), breakdown: [], limitations: [] };
}

function movementOf(entry: CoreEntry<ActionDefinitionPayload>, profile: CharacterMechanicalProfile): GeneralActionCardSection["movementGrant"] {
  const grant = entry.payload.movementGrant;
  if (grant === null) return null;
  const inputs = grant.formula.variables.map((v) => {
    const { source } = v;
    const statistic = source.kind === "DERIVED" ? source.statistic : null;
    const row = statistic === null ? undefined : profile.derivedStatistics.find((d) => d.statistic === statistic);
    const current: CardValue<number> = row === undefined ? unavailable("ACTION.INPUT_NOT_ON_PROFILE", `${v.variable} is not a derived statistic of this Character's profile`) : available(row.value);
    return { variable: v.variable, statistic, current };
  });
  return { expression: grant.formula.expression, unit: grant.formula.unit, inputs, value: deferred<number>("ACTION.RUNTIME_EVALUATED", "the granted Movement is evaluated by the runtime when the Action is taken (M5-WO3 ACTION_FOLLOW_ON)") };
}

function rulesOf(entry: CoreEntry<ActionDefinitionPayload>, movement: GeneralActionCardSection["movementGrant"], improvements: readonly ActionImprovementEvaluation[], profile: CharacterMechanicalProfile): GeneralActionRules {
  const p = entry.payload;
  const unit = (statistic: string | null) => (statistic === null ? null : (profile.derivedStatistics.find((d) => d.statistic === statistic)?.unit ?? null));
  return deepFreeze(
    clonePlainData({
      kind: "GENERAL_ACTION" as const,
      timing: p.timing,
      requiresTrigger: p.requiresTrigger,
      cost: p.actionPointCost,
      otherCosts: p.otherCosts.map((c) => ({ costKey: c.costKey, amount: c.amount })),
      movementGrant:
        movement === null
          ? null
          : { expression: movement.expression, unit: movement.unit, inputs: movement.inputs.map((x) => ({ variable: x.variable, statistic: x.statistic, current: x.current.status === "AVAILABLE" ? x.current.value : null, unit: unit(x.statistic) })) },
      improvements: improvements
        .filter((e) => e.status === "ACTIVE" || e.status === "CONDITIONAL")
        .map((e) => ({
          improvement: e.improvement,
          improvementKey: e.improvementKey,
          status: e.status,
          modifications: e.applicability.modifications.map((m) => ({ modificationKey: m.modificationKey, kind: m.kind, support: m.support, condition: m.condition === null ? null : conditionOf(m.condition), rulesText: m.rulesText, actionPointCost: m.actionPointCost?.amount ?? null })),
        })),
      unresolved: improvements.filter((e) => e.status === "ACTIVE" || e.status === "CONDITIONAL").flatMap((e) => e.applicability.modifications.filter((m) => m.support === "UNSUPPORTED").map((m) => ({ code: "ACTION_IMPROVEMENT.OPERATION_UNSUPPORTED", message: `${e.improvementKey}.${m.modificationKey}: ${m.reason ?? "unsupported"}` }))),
    }),
  ) as GeneralActionRules;
}

/** One General Action card for one exact ACTION Definition pinned by the Character's Release. */
export function projectGeneralActionCard(input: { readonly entry: CoreEntry<ActionDefinitionPayload>; readonly bundle: ProwessDefinitionBundle; readonly profile: CharacterMechanicalProfile; readonly context: CharacterCardContext; readonly description?: string }): GeneralActionCard {
  const { entry, bundle, profile, context: ctx } = input;
  const lang: LanguageContext = { labelOf: labelFrom(ctx.names) };
  const improvements = actionImprovementsFor({ bundle, profile, action: entry.ref });
  const costs = costsOf(entry, improvements);
  const movement = movementOf(entry, profile);
  const rules = rulesOf(entry, movement, improvements, profile);
  const instructions = renderGeneralActionRules(rules, lang);
  const limitations: CardLimitation[] = [...costs.limitations, ...improvements.filter((e) => e.status === "UNRESOLVED").flatMap((e) => e.reasons.map((r) => ({ code: r.code, message: `${e.improvementKey}: ${r.message}` })))];
  const sources = [entry.ref, ...improvements.map((e) => e.improvement)];
  const cardKey = generalActionCardKey(entry.ref);
  const notApplicable = "ACTION Definitions author no targeting";
  return deepFreeze(
    clonePlainData({
      contractVersion: CARD_CONTRACT_VERSION,
      cardKey,
      category: "GENERAL_ACTION" as const,
      name: lang.labelOf(entry.ref),
      description: input.description ?? "",
      artwork: { kind: "PLACEHOLDER" as const },
      availability: "AVAILABLE" as const,
      provenance: { rulesetProvenance: ctx.rulesetProvenance, characterReleaseId: ctx.characterReleaseId, characterId: ctx.characterId, ability: null, sources, evaluation: { authority: AUTHORITY, state: "NO_REQUIREMENTS" } },
      costs: { ap: costs.ap, mp: unavailable<number>("CARD.NOT_APPLICABLE", "General Actions author no MP cost"), breakdown: costs.breakdown },
      targeting: unavailable("CARD.NOT_APPLICABLE", notApplicable),
      rules: available(rules),
      instructions,
      limitations,
      section: {
        kind: "GENERAL_ACTION" as const,
        action: entry.ref,
        actionKey: entry.payload.actionKey,
        timing: entry.payload.timing,
        requiresTrigger: entry.payload.requiresTrigger,
        eligibility: { status: "NO_REQUIREMENTS" as const },
        otherCosts: entry.payload.otherCosts,
        movementGrant: movement,
        costOverridableByExplicitRule: entry.payload.costOverridableByExplicitRule,
        source: entry.payload.source,
        improvements: improvements.map(improvementEntry),
      },
      snapshot: { contractVersion: CARD_CONTRACT_VERSION, cardKey, rulesetProvenance: ctx.rulesetProvenance, characterReleaseId: ctx.characterReleaseId, ability: null, sources: sources.map((s) => s.entityVersionId) },
    }),
  ) as GeneralActionCard;
}

export interface ActionDirectory {
  readonly status: "READY" | "UNAVAILABLE";
  readonly reasons: readonly CardLimitation[];
  /** One card per ACTION the Release pins, ordered by canonical key. */
  readonly cards: readonly GeneralActionCard[];
  /** Improvements whose exact parent ACTION this Release does not pin (shown, never attached elsewhere). */
  readonly unattached: readonly CardImprovementEntry[];
}

/**
 * The Character's Action Directory: every ACTION Definition its Release pins, as General Action cards. Fails closed as
 * a whole when the Release's runtime Definitions are not coherent (the M5 runtime index refuses them).
 */
export function buildActionDirectory(input: { readonly bundle: ProwessDefinitionBundle; readonly profile: CharacterMechanicalProfile; readonly context: CharacterCardContext; readonly descriptions?: Readonly<Record<string, string>> }): ActionDirectory {
  const { bundle, profile, context } = input;
  const index = indexRuntimeDefinitions(bundle);
  if (!index.ok) return deepFreeze({ status: "UNAVAILABLE" as const, reasons: index.problems.map((q) => ({ code: q.code, message: q.message })), cards: [], unattached: [] });
  const entries = Object.values(index.value.actions).sort((a, b) => (a.ref.canonicalKey < b.ref.canonicalKey ? -1 : a.ref.canonicalKey > b.ref.canonicalKey ? 1 : 0));
  const cards = entries.map((entry) => projectGeneralActionCard({ entry, bundle, profile, context, description: input.descriptions?.[entry.ref.entityVersionId] }));
  const pinned = entries.map((e) => e.ref.entityId);
  const unattached = bundle.definitions
    .filter((d) => d.definitionKind === "ACTION_IMPROVEMENT" && !pinned.includes((d.payload as unknown as ActionImprovementPayload).action.entityId))
    .sort((a, b) => (a.canonicalKey < b.canonicalKey ? -1 : a.canonicalKey > b.canonicalKey ? 1 : 0))
    .map((improvement) => improvementEntry(evaluateActionImprovement({ bundle, profile, improvement })));
  return deepFreeze({ status: "READY" as const, reasons: [], cards, unattached });
}
