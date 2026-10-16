import type { JsonObject } from "@prowess/model";
import { clonePlainData, isPlainObject, type PathSegment } from "../internal/plain-data.js";
import { Problems, checkPlainData, finish, isExactCanonicalKey, isExactLabel, own, readEnum, readRecord, readSafeInteger, type ProwessOutcome } from "../internal/problems.js";
import { COMPOSITION_ERROR_CODES as K, DEFINITION_ERROR_CODES as C } from "../definition/codes.js";
import { readDefinitionRef, type ProwessDefinitionRef } from "../definition/envelope.js";
import { findBundleDefinition, type ProwessDefinitionBundle } from "../bundle/bundle.js";
import { ABILITY_KINDS, ABILITY_SLOT_KINDS, isAbilityKind, type AbilityKind, type AbilitySlot, type ProwessDefinitionKind } from "../vocabulary/families.js";
import { TRAIT_SCOPES, type TraitScope } from "../vocabulary/construction.js";

/**
 * Prowess Ability Construction — the COMPOSITION layer (PAS-10 M5-WO1 §20–24, §63–64, §110–112).
 *
 * A Composition is an authored configuration: "this Spell uses Radius + Direct Damage + Fire Conversion + Timed
 * Duration". It references exact Definitions; it never contains or alters them (M5-I015), and it holds no runtime
 * state — no current HP / MP / AP, position, targets or round data (M5-I016). Spell and Maneuver share this grammar
 * (M5-I025) while every slot requires its OWN branch's Definition kind (M5-I036, M5-I038).
 *
 * AbilityKind is explicit. Nothing here infers a kind from the presence of a weapon, an MP cost or any other field.
 */

/** One configured use of an exact Definition. `parameters` are the player's / author's choices for this use. */
export interface ComponentUse {
  readonly componentKey: string;
  readonly definition: ProwessDefinitionRef;
  readonly parameters: JsonObject;
}

/** A use whose position is authored explicitly (§41). Array order alone is never semantic. */
export interface OrderedComponentUse extends ComponentUse {
  readonly order: number;
}

/** A Trait use states exactly what it modifies (§45): a scope and, unless ability-wide, the target component. */
export interface TraitUse extends OrderedComponentUse {
  readonly appliesTo: { readonly scope: TraitScope; readonly componentKey: string | null };
}

/**
 * Spell-specific composition data (§111). Effect-chain, Sustain / Mana Lock and Concentration metadata are authored
 * data whose semantics belong to M5-WO12 / M5-WO13; WO1 only gives them a home (§42).
 */
export interface SpellBranchData {
  readonly kind: "SPELL";
  readonly effectChain: JsonObject | null;
  readonly sustain: JsonObject | null;
  readonly concentration: JsonObject | null;
  readonly data: JsonObject;
}

/** Maneuver-specific composition data (§112). Martial access, AP / optional MP structure and criticals are later WOs. */
export interface ManeuverBranchData {
  readonly kind: "MANEUVER";
  readonly foundation: ComponentUse | null;
  readonly martialAccess: JsonObject | null;
  readonly resolutionProfile: JsonObject | null;
  readonly data: JsonObject;
}

export interface AbilityCompositionBase<Kind extends AbilityKind, Branch> {
  readonly compositionKey: string;
  readonly abilityKind: Kind;
  /** Affinity may participate in either branch (§54); it never changes AbilityKind (§55, M5-I039). */
  readonly affinity: ComponentUse | null;
  /** Branch-specific authority / access data (§56) — Arcana / Affinity Authority, Martial Rank … Later WOs. */
  readonly authority: JsonObject | null;
  readonly keywords: readonly string[];
  readonly targeting: ComponentUse;
  readonly effects: readonly OrderedComponentUse[];
  readonly traits: readonly TraitUse[];
  readonly duration: ComponentUse | null;
  readonly conditions: readonly OrderedComponentUse[];
  readonly branch: Branch;
}

export type SpellComposition = AbilityCompositionBase<"SPELL", SpellBranchData>;
export type ManeuverComposition = AbilityCompositionBase<"MANEUVER", ManeuverBranchData>;
export type AbilityComposition = SpellComposition | ManeuverComposition;

const COMPOSITION_FIELDS = ["compositionKey", "abilityKind", "affinity", "authority", "keywords", "targeting", "effects", "traits", "duration", "conditions", "branch"];
const BRANCH_FIELDS: Readonly<Record<AbilityKind, readonly string[]>> = {
  SPELL: ["kind", "effectChain", "sustain", "concentration", "data"],
  MANEUVER: ["kind", "foundation", "martialAccess", "resolutionProfile", "data"],
};

class CompositionReader {
  readonly keys = new Map<string, AbilitySlot | "affinity">();
  constructor(
    readonly p: Problems,
    readonly abilityKind: AbilityKind,
    readonly bundle: ProwessDefinitionBundle | null,
  ) {}

  ref(value: unknown, at: readonly PathSegment[], required: ProwessDefinitionKind): ProwessDefinitionRef | null {
    const ref = readDefinitionRef(value, at, this.p, K.INVALID_REFERENCE);
    if (ref === null) return null;
    if (ref.definitionKind !== required) {
      const other = ABILITY_KINDS.find((k) => k !== this.abilityKind);
      const crossBranch = other !== undefined && Object.values(ABILITY_SLOT_KINDS[other]).includes(ref.definitionKind as never);
      this.p.add(
        crossBranch ? K.CROSS_BRANCH_DEFINITION : K.INVALID_REFERENCE,
        [...at, "definitionKind"],
        `this ${this.abilityKind} slot requires a ${required} Definition; ${ref.definitionKind} is never interchangeable with it, even when it satisfies the same shared contract`,
      );
      return null;
    }
    if (this.bundle !== null && findBundleDefinition(this.bundle, ref) === null) {
      this.p.add(K.UNRESOLVED_REFERENCE, at, "this exact Definition version is not in the exact Definition bundle");
      return null;
    }
    return ref;
  }

  use(value: unknown, at: readonly PathSegment[], slot: AbilitySlot | "affinity", required: ProwessDefinitionKind, extra: readonly string[] = []): (ComponentUse & Record<string, unknown>) | null {
    const fields = ["componentKey", "definition", "parameters", ...extra];
    const r = readRecord(value, at, this.p, K.INVALID_COMPOSITION, fields, ["componentKey", "definition", ...extra.filter((f) => f === "order" || f === "appliesTo")]);
    if (r === null) return null;
    const before = this.p.count;
    const componentKey = own(r, "componentKey");
    if (!isExactLabel(componentKey)) this.p.add(K.INVALID_COMPOSITION, [...at, "componentKey"], "componentKey is an exact label");
    else if (this.keys.has(componentKey)) this.p.add(K.DUPLICATE_COMPONENT, [...at, "componentKey"], `componentKey "${componentKey}" is used twice`);
    else this.keys.set(componentKey, slot);
    const definition = this.ref(own(r, "definition"), [...at, "definition"], required);
    const rawParameters = own(r, "parameters") ?? {};
    if (!isPlainObject(rawParameters)) this.p.add(K.INVALID_COMPOSITION, [...at, "parameters"], "parameters is a plain object of authored choices");
    if (this.p.count > before || definition === null) return null;
    return { ...r, componentKey: componentKey as string, definition, parameters: clonePlainData(rawParameters as JsonObject) };
  }

  ordered(value: unknown, at: readonly PathSegment[], slot: AbilitySlot, required: ProwessDefinitionKind, extra: readonly string[] = []): OrderedComponentUse[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      this.p.add(K.INVALID_COMPOSITION, at, `${slot} is an array of explicitly ordered component uses`);
      return [];
    }
    const out: OrderedComponentUse[] = [];
    const orders = new Set<number>();
    value.forEach((item: unknown, i: number) => {
      const u = this.use(item, [...at, i], slot, required, ["order", ...extra]);
      if (u === null) return;
      const order = readSafeInteger(own(u, "order"), [...at, i, "order"], this.p, K.INVALID_COMPOSITION, "order");
      if (order === null) return;
      if (orders.has(order)) {
        this.p.add(K.AMBIGUOUS_ORDER, [...at, i, "order"], `two ${slot} share order ${order}; authored order must be explicit and unambiguous`);
        return;
      }
      orders.add(order);
      out.push({ ...u, order } as OrderedComponentUse);
    });
    return out.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
  }
}

const nullableObject = (value: unknown, at: readonly PathSegment[], p: Problems, fallback: JsonObject | null): JsonObject | null => {
  if (value === undefined) return fallback;
  if (value === null && fallback === null) return null;
  if (isPlainObject(value)) return clonePlainData(value as JsonObject);
  p.add(K.INVALID_COMPOSITION, at, "expected a plain object of authored data");
  return null;
};

const pick = <T extends object>(value: T, keys: readonly (keyof T)[]): T => Object.fromEntries(keys.map((k) => [k, value[k]])) as T;

/**
 * Structurally validates an Ability Composition (§144): explicit AbilityKind, branch data of the same kind, exact
 * references of the exact branch Definition kind in every slot, unique component keys, explicit unambiguous order and
 * scoped Traits. With `bundle`, every reference must also resolve EXACTLY in that bundle (and a Trait's authored scope
 * must equal its Definition's scope). It does not decide game legality — Rank, cost, range or capacity (§144).
 */
export function validateAbilityComposition(input: unknown, options: { readonly bundle?: ProwessDefinitionBundle } = {}): ProwessOutcome<AbilityComposition> {
  const p = new Problems();
  if (!checkPlainData(input, [], p, C.NOT_PLAIN_DATA)) return finish(p, () => null as never);
  if (!isPlainObject(input)) {
    p.add(K.INVALID_COMPOSITION, [], "a Composition is a plain object");
    return finish(p, () => null as never);
  }
  const abilityKind = own(input, "abilityKind");
  if (!isAbilityKind(abilityKind)) {
    p.add(K.ABILITY_KIND_REQUIRED, ["abilityKind"], `abilityKind is required and explicit (${ABILITY_KINDS.join(" | ")}); it is never inferred from the Composition's contents`);
    return finish(p, () => null as never);
  }
  const r = readRecord(input, [], p, K.INVALID_COMPOSITION, COMPOSITION_FIELDS, ["compositionKey", "abilityKind", "targeting", "branch"]);
  if (r === null) return finish(p, () => null as never);
  const reader = new CompositionReader(p, abilityKind, options.bundle ?? null);
  const slots = ABILITY_SLOT_KINDS[abilityKind];

  const compositionKey = own(r, "compositionKey");
  if (!isExactLabel(compositionKey)) p.add(K.INVALID_COMPOSITION, ["compositionKey"], "compositionKey is an exact label");

  const rawAffinity = own(r, "affinity");
  const affinity = rawAffinity === undefined || rawAffinity === null ? null : reader.use(rawAffinity, ["affinity"], "affinity", "AFFINITY");
  const authority = nullableObject(own(r, "authority"), ["authority"], p, null);

  const rawKeywords = own(r, "keywords") ?? [];
  const keywords = new Set<string>();
  if (!Array.isArray(rawKeywords)) p.add(K.INVALID_COMPOSITION, ["keywords"], "keywords is an array of exact Keyword canonical keys");
  else
    rawKeywords.forEach((k: unknown, i: number) => {
      if (!isExactCanonicalKey(k) || keywords.has(k)) p.add(K.INVALID_COMPOSITION, ["keywords", i], "a unique exact Keyword canonical key");
      else keywords.add(k);
    });

  const targeting = reader.use(own(r, "targeting"), ["targeting"], "targeting", slots.targeting);
  const effects = reader.ordered(own(r, "effects"), ["effects"], "effects", slots.effects);
  const conditions = reader.ordered(own(r, "conditions"), ["conditions"], "conditions", slots.conditions);
  const rawDuration = own(r, "duration");
  const duration = rawDuration === undefined || rawDuration === null ? null : reader.use(rawDuration, ["duration"], "duration", slots.duration);

  // Branch data — after the shared slots, so the foundation (a Maneuver component) has a registered key.
  const rawBranch = own(r, "branch");
  let branch: SpellBranchData | ManeuverBranchData | null = null;
  if (isPlainObject(rawBranch) && own(rawBranch, "kind") !== abilityKind) {
    p.add(K.BRANCH_MISMATCH, ["branch", "kind"], `branch.kind must equal abilityKind ${abilityKind}`);
  } else {
    const b = readRecord(rawBranch, ["branch"], p, K.INVALID_COMPOSITION, BRANCH_FIELDS[abilityKind], ["kind"]);
    if (b !== null) {
      const data = nullableObject(own(b, "data"), ["branch", "data"], p, {}) ?? {};
      if (abilityKind === "SPELL") {
        branch = {
          kind: "SPELL",
          effectChain: nullableObject(own(b, "effectChain"), ["branch", "effectChain"], p, null),
          sustain: nullableObject(own(b, "sustain"), ["branch", "sustain"], p, null),
          concentration: nullableObject(own(b, "concentration"), ["branch", "concentration"], p, null),
          data,
        };
      } else {
        const rawFoundation = own(b, "foundation");
        const foundation =
          rawFoundation === undefined || rawFoundation === null ? null : reader.use(rawFoundation, ["branch", "foundation"], "foundation", slots.foundation as ProwessDefinitionKind);
        branch = {
          kind: "MANEUVER",
          foundation: foundation === null ? null : pick(foundation, ["componentKey", "definition", "parameters"]),
          martialAccess: nullableObject(own(b, "martialAccess"), ["branch", "martialAccess"], p, null),
          resolutionProfile: nullableObject(own(b, "resolutionProfile"), ["branch", "resolutionProfile"], p, null),
          data,
        };
      }
    }
  }

  // Traits last: each names the component it modifies.
  const traits = reader.ordered(own(r, "traits"), ["traits"], "traits", slots.traits, ["appliesTo"]).flatMap((t, i): TraitUse[] => {
    const at = ["traits", i, "appliesTo"];
    const a = readRecord(own(t as unknown as Record<string, unknown>, "appliesTo"), at, p, K.INVALID_TRAIT_TARGET, ["scope", "componentKey"], ["scope"]);
    if (a === null) return [];
    const scope = readEnum(own(a, "scope"), TRAIT_SCOPES, [...at, "scope"], p, K.INVALID_TRAIT_TARGET, "trait scope");
    const target = own(a, "componentKey") ?? null;
    const expectedSlot: Partial<Record<TraitScope, AbilitySlot>> = { EFFECT_SPECIFIC: "effects", TARGETING: "targeting", DURATION: "duration", CONDITION: "conditions" };
    if (scope === null) return [];
    if (scope === "ABILITY_WIDE") {
      if (target !== null) p.add(K.INVALID_TRAIT_TARGET, [...at, "componentKey"], "an ability-wide Trait names no single component");
    } else if (typeof target !== "string" || reader.keys.get(target) !== expectedSlot[scope]) {
      p.add(K.INVALID_TRAIT_TARGET, [...at, "componentKey"], `a ${scope} Trait names the componentKey of a ${expectedSlot[scope]} component of this Composition`);
      return [];
    }
    if (options.bundle !== undefined) {
      const definition = findBundleDefinition(options.bundle, t.definition);
      const definedScope = definition === null ? null : (definition.payload as { scope?: unknown }).scope;
      if (definedScope !== scope) p.add(K.INVALID_TRAIT_TARGET, [...at, "scope"], `the Trait Definition's scope is ${String(definedScope)}`);
    }
    return [{ ...pick(t, ["componentKey", "definition", "parameters", "order"]), appliesTo: { scope, componentKey: scope === "ABILITY_WIDE" ? null : (target as string) } }];
  });

  const strip = (u: ComponentUse | null) => (u === null ? null : pick(u, ["componentKey", "definition", "parameters"]));
  const stripOrdered = (list: OrderedComponentUse[]) => list.map((u) => pick(u, ["componentKey", "definition", "parameters", "order"]));
  return finish(p, () => ({
    compositionKey: compositionKey as string,
    abilityKind,
    affinity: strip(affinity),
    authority,
    keywords: [...keywords].sort(),
    targeting: strip(targeting) as ComponentUse,
    effects: stripOrdered(effects),
    traits,
    duration: strip(duration),
    conditions: stripOrdered(conditions),
    branch: branch as SpellBranchData & ManeuverBranchData,
  }) as AbilityComposition);
}

/**
 * Every component use of a Composition in its canonical, deterministic order: affinity, targeting, effects (by
 * order), traits (by order), duration, conditions (by order), then the Maneuver foundation. This is the order later
 * compilers walk; it never depends on object-key or insertion order.
 */
export function compositionComponents(composition: AbilityComposition): readonly { readonly slot: AbilitySlot | "affinity"; readonly use: ComponentUse }[] {
  const out: { slot: AbilitySlot | "affinity"; use: ComponentUse }[] = [];
  if (composition.affinity !== null) out.push({ slot: "affinity", use: composition.affinity });
  out.push({ slot: "targeting", use: composition.targeting });
  for (const use of composition.effects) out.push({ slot: "effects", use });
  for (const use of composition.traits) out.push({ slot: "traits", use });
  if (composition.duration !== null) out.push({ slot: "duration", use: composition.duration });
  for (const use of composition.conditions) out.push({ slot: "conditions", use });
  if (composition.branch.kind === "MANEUVER" && composition.branch.foundation !== null) out.push({ slot: "foundation", use: composition.branch.foundation });
  return out;
}
