import type { ActorContext, EvaluationOperation, EvaluationPlan, RuntimeContext } from "@prowess/rules";
import type { JsonObject } from "@prowess/model";
import { canonicalJsonOf, deepFreeze, isPlainObject } from "../internal/plain-data.js";
import { Problems, checkPlainData, finish, isExactCanonicalKey, isExactLabel, isToken, own, readEnum, readRecord, readSafeInteger, type ProwessOutcome } from "../internal/problems.js";
import { availabilityOrder, chainOrder, RUNTIME_ORDER } from "../internal/order.js";
import { COMPILATION_ERROR_CODES as X, DEFINITION_ERROR_CODES as C, RUNTIME_ERROR_CODES as R } from "../definition/codes.js";
import type { ProwessDefinitionRef } from "../definition/envelope.js";
import type { CoreFormula } from "../definition/core-payload.js";
import type { ActionDefinitionPayload, ResourceDefinitionPayload, TerrainDefinitionPayload } from "../definition/runtime-payload.js";
import type { ProwessDefinitionBundle, ProwessRulesetProvenance } from "../bundle/bundle.js";
import { assembleFragments, compiledStepKey } from "../compilation/assemble.js";
import type { CompilationFragmentBinding, ProwessCompilationSourceMap } from "../compilation/model.js";
import { PROWESS_COMPILATION_CONTRACT_VERSION, SUPPORTED_PROWESS_COMPILATION_CONTRACT_VERSIONS, type ProwessCompilationContractVersion } from "../contract-version.js";
import { Emitter, fromContext, fromFragment, pointer, program, readCoreBundle } from "../core/compile.js";
import { buildCharacterActorContext, validateCharacterCore } from "../core/character.js";
import { indexCoreDefinitions, type CoreEntry } from "../core/definitions.js";
import { DERIVED_STATISTICS, type DerivedStatistic } from "../vocabulary/core.js";
import {
  ACTION_TIMINGS,
  COMBAT_TIMING_EVENTS,
  RESOURCE_CONTEXT_KEYS,
  RESOURCE_TRANSITION_OPERATIONS,
  RUNTIME_RESOURCE_KEYS,
  RUNTIME_STATE_KEYS,
  TERRAIN_KINDS,
  type ActionTiming,
  type CombatTimingEvent,
  type PaymentPolicy,
  type ResourceTransitionOperation,
  type RuntimeResourceKey,
  type TerrainKind,
} from "../vocabulary/runtime.js";
import { indexRuntimeDefinitions, paymentSourcesOf, type RuntimeDefinitionIndex } from "./definitions.js";
import { buildRuntimeContext, validateCombatTiming, validateRuntimeResources, type CombatTiming, type ProwessRuntimeResources } from "./resources.js";

/**
 * Runtime Resource / action-economy compilation (PAS-10 M5-WO3 §93–96, §171–172). Exact Definitions + a CharacterCore +
 * the caller's runtime Resource state + a subject → ONE M4 EvaluationPlan. The plan is a CHAIN of M4 Resource
 * operations: the first link's snapshot binds every involved Resource's current value from the RuntimeContext and its
 * maximum from the exact WO2 capacity statistic (an M4 FORMULA step); each later link reads the previous link's
 * `resultingResources`. M4 performs every spend, restore, refresh, reservation, release, payment allocation and
 * Formula; this module chooses WHICH authored operation runs and wires its inputs. It computes no game value, branches
 * on no Resource name, never mutates its inputs and never persists anything (M5-I095, M5-I105).
 */
export const RUNTIME_SUBJECT_KINDS = deepFreeze(["RESOURCE_STATE", "RESOURCE_TIMING", "RESOURCE_TRANSITIONS", "MAGICAL_PAYMENT", "ACTION_PAYMENT", "ACTION_FOLLOW_ON", "MOVEMENT"] as const);
export type RuntimeSubjectKind = (typeof RUNTIME_SUBJECT_KINDS)[number];

/** RESOURCE_INITIALIZATION: the M4-validated runtime state of the listed (default: every supplied) Resource. */
export interface ResourceStateSubject {
  readonly kind: "RESOURCE_STATE";
  readonly subjectKey: string;
  readonly resources?: readonly RuntimeResourceKey[];
}

/** ROUND_REFRESH / TURN_REFRESH: every authored refresh / expiry at one timing event, plus usage availability. */
export interface ResourceTimingSubject {
  readonly kind: "RESOURCE_TIMING";
  readonly subjectKey: string;
  readonly event: CombatTimingEvent;
  /** Explicit rules preserving a Resource that would otherwise expire (only where the Definition allows it). */
  readonly preserve?: readonly { readonly resourceKey: RuntimeResourceKey; readonly sourceKey: string }[];
}

/** RESOURCE_TRANSITION: an ordered list of explicit transitions with already-resolved amounts. */
export interface ResourceTransitionsSubject {
  readonly kind: "RESOURCE_TRANSITIONS";
  readonly subjectKey: string;
  readonly transitions: readonly { readonly resourceKey: RuntimeResourceKey; readonly operation: ResourceTransitionOperation; readonly amount: number; readonly sourceKey?: string }[];
}

/** MAGICAL_PAYMENT: an already-calculated listed cost; ME pays first ONLY when the caller declares it ME-eligible. */
export interface MagicalPaymentSubject {
  readonly kind: "MAGICAL_PAYMENT";
  readonly subjectKey: string;
  readonly costKey: string;
  readonly listedAmount: number;
  readonly meEligible: boolean;
  readonly sourceKey?: string;
}

/** ACTION_PAYMENT (ActionExecutionRequest, phase 1): the action's costs, its usage availability and its timing. */
export interface ActionPaymentSubject {
  readonly kind: "ACTION_PAYMENT";
  readonly subjectKey: string;
  readonly actionKey: string;
  readonly window: ActionTiming;
  /** The AP cost chosen / determined for a RANGE, MINIMUM or VARIABLE action. Forbidden for FIXED and NONE. */
  readonly actionPointCost?: number;
  /** For a VARIABLE cost: the exact canonical key of what determined it (a spell, a Skill Action). */
  readonly costSourceKey?: string;
  /** An explicit rule replacing a FIXED cost (s44, s432 — "specific abilities may modify these costs"). */
  readonly costOverride?: { readonly amount: number; readonly sourceKey: string };
  /** The trigger that permits an action outside the creature's own turn. */
  readonly trigger?: { readonly triggerKey: string; readonly sourceKey: string };
}

/** ACTION_FOLLOW_ON (phase 2): the action's secondary benefit, compiled only from a confirmed PAID receipt (§76). */
export interface ActionFollowOnSubject {
  readonly kind: "ACTION_FOLLOW_ON";
  readonly subjectKey: string;
  readonly receipt: unknown;
}

/** MOVEMENT_ALLOWANCE: spend allowance for movement segments, each at its terrain's authored cost (s437, s439). */
export interface MovementSubject {
  readonly kind: "MOVEMENT";
  readonly subjectKey: string;
  readonly segments: readonly { readonly distance: number; readonly terrainKey: TerrainKind }[];
}

export type RuntimeCompilationSubject = ResourceStateSubject | ResourceTimingSubject | ResourceTransitionsSubject | MagicalPaymentSubject | ActionPaymentSubject | ActionFollowOnSubject | MovementSubject;

export interface RuntimeCompilationRequest {
  readonly contractVersion: ProwessCompilationContractVersion;
  readonly subject: RuntimeCompilationSubject;
  readonly definitions: ProwessDefinitionBundle;
  readonly ruleset: unknown;
  readonly character: unknown;
  readonly resources: unknown;
  readonly combat?: unknown;
}

/** One compiled payment: its literal listed amount (never rewritten) and its preview / apply steps. */
export interface RuntimeCompiledPayment {
  readonly costKey: string;
  readonly policy: PaymentPolicy;
  readonly listedAmount: number;
  readonly preview: string;
  readonly apply: string;
}

/** Which compiled step holds which result. Pure naming — no values. */
export interface RuntimeCompiledOutputs {
  /** The step whose `/data/resultingResources` holds each involved Resource's final state in this plan. */
  readonly resources: Readonly<Partial<Record<RuntimeResourceKey, string>>>;
  readonly transitions: readonly { readonly resourceKey: RuntimeResourceKey; readonly operation: string; readonly stepKey: string }[];
  readonly payments: readonly RuntimeCompiledPayment[];
  readonly availability: readonly { readonly resourceKey: RuntimeResourceKey; readonly restrictionKey: string; readonly stepKey: string }[];
  /** Resources whose expiry was preserved by an explicit rule, with that rule's key. */
  readonly preserved: readonly { readonly resourceKey: RuntimeResourceKey; readonly sourceKey: string }[];
  readonly movementGrant: string | null;
  readonly movementCosts: readonly string[];
  /**
   * REQUIREMENT steps: an involved Resource whose Definition exposes depletion (HP) sits at its minimum. Exposed only —
   * Downed, Death Saves and Lethal / Non-Lethal outcomes are a later subsystem (M5-I107).
   */
  readonly depletion: readonly { readonly resourceKey: RuntimeResourceKey; readonly stepKey: string }[];
  readonly derived: Readonly<Partial<Record<DerivedStatistic, string>>>;
}

export interface ProwessRuntimeCompiledPlan {
  readonly contractVersion: ProwessCompilationContractVersion;
  readonly subject: {
    readonly kind: RuntimeSubjectKind;
    readonly subjectKey: string;
    readonly event: CombatTimingEvent | null;
    readonly actionKey: string | null;
    readonly actionCanonicalKey: string | null;
  };
  readonly rulesetProvenance: ProwessRulesetProvenance;
  readonly evaluationPlan: EvaluationPlan;
  readonly sourceMap: ProwessCompilationSourceMap;
  readonly outputs: RuntimeCompiledOutputs;
}

const REQUEST_FIELDS = ["contractVersion", "subject", "definitions", "ruleset", "character", "resources", "combat"];
const SUBJECT_FIELDS: Readonly<Record<RuntimeSubjectKind, readonly string[]>> = {
  RESOURCE_STATE: ["kind", "subjectKey", "resources"],
  RESOURCE_TIMING: ["kind", "subjectKey", "event", "preserve"],
  RESOURCE_TRANSITIONS: ["kind", "subjectKey", "transitions"],
  MAGICAL_PAYMENT: ["kind", "subjectKey", "costKey", "listedAmount", "meEligible", "sourceKey"],
  ACTION_PAYMENT: ["kind", "subjectKey", "actionKey", "window", "actionPointCost", "costSourceKey", "costOverride", "trigger"],
  ACTION_FOLLOW_ON: ["kind", "subjectKey", "receipt"],
  MOVEMENT: ["kind", "subjectKey", "segments"],
};
const SUBJECT_REQUIRED: Readonly<Record<RuntimeSubjectKind, readonly string[]>> = {
  RESOURCE_STATE: ["kind", "subjectKey"],
  RESOURCE_TIMING: ["kind", "subjectKey", "event"],
  RESOURCE_TRANSITIONS: ["kind", "subjectKey", "transitions"],
  MAGICAL_PAYMENT: ["kind", "subjectKey", "costKey", "listedAmount", "meEligible"],
  ACTION_PAYMENT: ["kind", "subjectKey", "actionKey", "window"],
  ACTION_FOLLOW_ON: ["kind", "subjectKey", "receipt"],
  MOVEMENT: ["kind", "subjectKey", "segments"],
};
/** The numeric encoding of "surprised" in the RuntimeContext (a Requirement fact compares numbers only). */
const SURPRISED_FACT_TRUE = 1;
const SNAPSHOT_RESULT = "/data/resultingResources";

const readAmount = (value: unknown, at: readonly (string | number)[], p: Problems, what: string): number | null => {
  const n = readSafeInteger(value, at, p, R.INVALID_RUNTIME_REQUEST, what);
  if (n !== null && n < 0) {
    p.add(R.NEGATIVE_RESOURCE_VALUE, at, `${what} is never negative`);
    return null;
  }
  return n;
};

function readSubject(value: unknown, p: Problems): RuntimeCompilationSubject | null {
  if (!isPlainObject(value)) {
    p.add(X.INVALID_REQUEST, ["subject"], `subject is { kind: ${RUNTIME_SUBJECT_KINDS.join(" | ")}, subjectKey, … }`);
    return null;
  }
  const kind = readEnum(own(value, "kind"), RUNTIME_SUBJECT_KINDS, ["subject", "kind"], p, X.INVALID_REQUEST, "runtime subject kind");
  if (kind === null) return null;
  const r = readRecord(value, ["subject"], p, X.INVALID_REQUEST, SUBJECT_FIELDS[kind], SUBJECT_REQUIRED[kind]);
  if (r === null) return null;
  const before = p.count;
  const subjectKey = own(r, "subjectKey");
  if (!isExactLabel(subjectKey) || subjectKey.includes(":")) p.add(X.INVALID_REQUEST, ["subject", "subjectKey"], "subjectKey is an exact label without ':'");
  const sourceKeyOf = (v: unknown, at: (string | number)[]) => {
    if (!isExactCanonicalKey(v)) p.add(R.INVALID_RUNTIME_REQUEST, at, "sourceKey is the exact canonical key of the rule that requested this");
    return v as string;
  };
  const key = subjectKey as string;
  switch (kind) {
    case "RESOURCE_STATE": {
      const raw = own(r, "resources");
      if (raw === undefined) return p.count > before ? null : { kind, subjectKey: key };
      const resources = Array.isArray(raw) ? raw.flatMap((x: unknown, i: number) => readEnum(x, RUNTIME_RESOURCE_KEYS, ["subject", "resources", i], p, R.INVALID_RUNTIME_REQUEST, "runtime Resource") ?? []) : (p.add(R.INVALID_RUNTIME_REQUEST, ["subject", "resources"], "resources is an array of Resource keys"), []);
      if (new Set(resources).size !== resources.length) p.add(R.INVALID_RUNTIME_REQUEST, ["subject", "resources"], "each Resource is listed once");
      return p.count > before ? null : { kind, subjectKey: key, resources };
    }
    case "RESOURCE_TIMING": {
      const event = readEnum(own(r, "event"), COMBAT_TIMING_EVENTS, ["subject", "event"], p, R.INVALID_TIMING, "combat timing event");
      const raw = own(r, "preserve") ?? [];
      const preserve: { resourceKey: RuntimeResourceKey; sourceKey: string }[] = [];
      if (!Array.isArray(raw)) p.add(R.INVALID_RUNTIME_REQUEST, ["subject", "preserve"], "preserve is an array of { resourceKey, sourceKey }");
      else
        raw.forEach((x: unknown, i: number) => {
          const e = readRecord(x, ["subject", "preserve", i], p, R.INVALID_RUNTIME_REQUEST, ["resourceKey", "sourceKey"], ["resourceKey", "sourceKey"]);
          const resourceKey = e === null ? null : readEnum(own(e, "resourceKey"), RUNTIME_RESOURCE_KEYS, ["subject", "preserve", i, "resourceKey"], p, R.INVALID_RUNTIME_REQUEST, "runtime Resource");
          if (e !== null && resourceKey !== null) preserve.push({ resourceKey, sourceKey: sourceKeyOf(own(e, "sourceKey"), ["subject", "preserve", i, "sourceKey"]) });
        });
      return p.count > before || event === null ? null : { kind, subjectKey: key, event, preserve };
    }
    case "RESOURCE_TRANSITIONS": {
      const raw = own(r, "transitions");
      const transitions: { resourceKey: RuntimeResourceKey; operation: ResourceTransitionOperation; amount: number; sourceKey?: string }[] = [];
      if (!Array.isArray(raw) || raw.length === 0) p.add(R.INVALID_RUNTIME_REQUEST, ["subject", "transitions"], "transitions is a non-empty ordered array");
      else
        raw.forEach((x: unknown, i: number) => {
          const at = ["subject", "transitions", i];
          const e = readRecord(x, at, p, R.INVALID_RUNTIME_REQUEST, ["resourceKey", "operation", "amount", "sourceKey"], ["resourceKey", "operation", "amount"]);
          if (e === null) return;
          const resourceKey = readEnum(own(e, "resourceKey"), RUNTIME_RESOURCE_KEYS, [...at, "resourceKey"], p, R.INVALID_RUNTIME_REQUEST, "runtime Resource");
          const operation = readEnum(own(e, "operation"), RESOURCE_TRANSITION_OPERATIONS, [...at, "operation"], p, R.TRANSITION_NOT_SUPPORTED, "Resource transition");
          const amount = readAmount(own(e, "amount"), [...at, "amount"], p, "amount");
          const sourceKey = own(e, "sourceKey") === undefined ? undefined : sourceKeyOf(own(e, "sourceKey"), [...at, "sourceKey"]);
          if (resourceKey !== null && operation !== null && amount !== null) transitions.push({ resourceKey, operation, amount, ...(sourceKey === undefined ? {} : { sourceKey }) });
        });
      return p.count > before ? null : { kind, subjectKey: key, transitions };
    }
    case "MAGICAL_PAYMENT": {
      const costKey = own(r, "costKey");
      if (!isExactLabel(costKey)) p.add(R.INVALID_RUNTIME_REQUEST, ["subject", "costKey"], "costKey is an exact label");
      const listedAmount = readAmount(own(r, "listedAmount"), ["subject", "listedAmount"], p, "listedAmount");
      const meEligible = own(r, "meEligible");
      if (typeof meEligible !== "boolean") p.add(R.INVALID_RUNTIME_REQUEST, ["subject", "meEligible"], "meEligible is an explicit boolean — ME eligibility is never assumed (M5-I090)");
      const sourceKey = own(r, "sourceKey") === undefined ? undefined : sourceKeyOf(own(r, "sourceKey"), ["subject", "sourceKey"]);
      if (p.count > before || listedAmount === null) return null;
      return { kind, subjectKey: key, costKey: costKey as string, listedAmount, meEligible: meEligible as boolean, ...(sourceKey === undefined ? {} : { sourceKey }) };
    }
    case "ACTION_PAYMENT": {
      const actionKey = own(r, "actionKey");
      if (!isToken(actionKey)) p.add(R.INVALID_RUNTIME_REQUEST, ["subject", "actionKey"], "actionKey is the exact SCREAMING_SNAKE action key");
      const window = readEnum(own(r, "window"), ACTION_TIMINGS, ["subject", "window"], p, R.INVALID_RUNTIME_REQUEST, "action window");
      const chosen = own(r, "actionPointCost") === undefined ? undefined : readAmount(own(r, "actionPointCost"), ["subject", "actionPointCost"], p, "actionPointCost");
      const costSourceKey = own(r, "costSourceKey") === undefined ? undefined : sourceKeyOf(own(r, "costSourceKey"), ["subject", "costSourceKey"]);
      let costOverride: ActionPaymentSubject["costOverride"];
      if (own(r, "costOverride") !== undefined) {
        const o = readRecord(own(r, "costOverride"), ["subject", "costOverride"], p, R.INVALID_RUNTIME_REQUEST, ["amount", "sourceKey"], ["amount", "sourceKey"]);
        const amount = o === null ? null : readAmount(own(o, "amount"), ["subject", "costOverride", "amount"], p, "override amount");
        if (o !== null && amount !== null) costOverride = { amount, sourceKey: sourceKeyOf(own(o, "sourceKey"), ["subject", "costOverride", "sourceKey"]) };
      }
      let trigger: ActionPaymentSubject["trigger"];
      if (own(r, "trigger") !== undefined) {
        const t = readRecord(own(r, "trigger"), ["subject", "trigger"], p, R.INVALID_RUNTIME_REQUEST, ["triggerKey", "sourceKey"], ["triggerKey", "sourceKey"]);
        if (t !== null && !isExactLabel(own(t, "triggerKey"))) p.add(R.INVALID_RUNTIME_REQUEST, ["subject", "trigger", "triggerKey"], "triggerKey is an exact label");
        if (t !== null) trigger = { triggerKey: own(t, "triggerKey") as string, sourceKey: sourceKeyOf(own(t, "sourceKey"), ["subject", "trigger", "sourceKey"]) };
      }
      if (p.count > before || window === null || chosen === null) return null;
      return {
        kind,
        subjectKey: key,
        actionKey: actionKey as string,
        window,
        ...(chosen === undefined ? {} : { actionPointCost: chosen }),
        ...(costSourceKey === undefined ? {} : { costSourceKey }),
        ...(costOverride === undefined ? {} : { costOverride }),
        ...(trigger === undefined ? {} : { trigger }),
      };
    }
    case "ACTION_FOLLOW_ON":
      return p.count > before ? null : { kind, subjectKey: key, receipt: own(r, "receipt") };
    case "MOVEMENT": {
      const raw = own(r, "segments");
      const segments: { distance: number; terrainKey: TerrainKind }[] = [];
      if (!Array.isArray(raw) || raw.length === 0) p.add(R.INVALID_RUNTIME_REQUEST, ["subject", "segments"], "segments is a non-empty ordered array of { distance, terrainKey }");
      else
        raw.forEach((x: unknown, i: number) => {
          const at = ["subject", "segments", i];
          const e = readRecord(x, at, p, R.INVALID_RUNTIME_REQUEST, ["distance", "terrainKey"], ["distance", "terrainKey"]);
          const distance = e === null ? null : readAmount(own(e, "distance"), [...at, "distance"], p, "distance (feet)");
          const terrainKey = e === null ? null : readEnum(own(e, "terrainKey"), TERRAIN_KINDS, [...at, "terrainKey"], p, R.UNKNOWN_TERRAIN, "terrain kind");
          if (distance !== null && terrainKey !== null) segments.push({ distance, terrainKey });
        });
      return p.count > before ? null : { kind, subjectKey: key, segments };
    }
  }
}

/** One compilation's runtime chain: the Resources it involves, its links, and the step names it exposes. */
class RuntimeChain {
  readonly involved: RuntimeResourceKey[] = [];
  readonly links: string[] = [];
  head: string | null = null;
  readonly outputs = {
    transitions: [] as { resourceKey: RuntimeResourceKey; operation: string; stepKey: string }[],
    payments: [] as { costKey: string; policy: PaymentPolicy; listedAmount: number; preview: string; apply: string }[],
    availability: [] as { resourceKey: RuntimeResourceKey; restrictionKey: string; stepKey: string }[],
    preserved: [] as { resourceKey: RuntimeResourceKey; sourceKey: string }[],
    movementGrant: null as string | null,
    movementCosts: [] as string[],
    depletion: [] as { resourceKey: RuntimeResourceKey; stepKey: string }[],
  };

  constructor(
    readonly e: Emitter,
    readonly index: RuntimeDefinitionIndex,
    readonly resources: ProwessRuntimeResources,
    readonly combat: CombatTiming | null,
    readonly p: Problems,
  ) {}

  /** The component key of a runtime Definition, registered with its exact entry. */
  component(family: string, key: string, entry: CoreEntry<unknown>): string {
    return this.e.component(`${family}.${key}`, [entry]);
  }

  resource(key: RuntimeResourceKey): CoreEntry<ResourceDefinitionPayload> {
    return this.index.resources[key];
  }

  /** Declares the Resources this plan's chain carries; each must be supplied as runtime state. */
  involve(keys: readonly RuntimeResourceKey[]): void {
    for (const key of keys) {
      if (this.involved.includes(key)) continue;
      if (!this.resources.resources.some((s) => s.resourceKey === key)) this.p.add(R.MISSING_RESOURCE_STATE, ["resources"], `this plan needs the runtime state of ${key}`);
      this.involved.push(key);
    }
    // M4 orders a snapshot by resourceKey; the template uses the same order so positions agree.
    this.involved.sort((a, b) => (RESOURCE_CONTEXT_KEYS[a] < RESOURCE_CONTEXT_KEYS[b] ? -1 : RESOURCE_CONTEXT_KEYS[a] > RESOURCE_CONTEXT_KEYS[b] ? 1 : 0));
  }

  /** Every Definition the given component keys use, for a fragment's citations. */
  cite(componentKeys: readonly string[]): ProwessDefinitionRef[] {
    const refs: ProwessDefinitionRef[] = [];
    for (const key of componentKeys) for (const ref of this.e.components.get(key) ?? []) if (!refs.includes(ref)) refs.push(ref);
    return refs;
  }

  /**
   * The snapshot input of a chain step: the initial template (every involved Resource, current from the
   * RuntimeContext, maximum from its WO2 capacity statistic) when nothing ran yet, otherwise the previous link's result.
   */
  snapshot(): { template: JsonObject; bindings: CompilationFragmentBinding[]; componentKeys: string[] } {
    if (this.head !== null) return { template: { resources: [] }, bindings: [fromFragment("/snapshot", this.head, SNAPSHOT_RESULT)], componentKeys: [] };
    const bindings: CompilationFragmentBinding[] = [];
    const componentKeys: string[] = [];
    const states = this.involved.map((key, i) => {
      const entry = this.resource(key);
      const d = entry.payload;
      const ctx = RESOURCE_CONTEXT_KEYS[key];
      componentKeys.push(this.component("resource", key, entry));
      bindings.push(fromContext(pointer("snapshot", "resources", String(i), "current"), "RUNTIME", pointer("resourceValues", ctx)));
      if (d.supportsReservation) bindings.push(fromContext(pointer("snapshot", "resources", String(i), "reservedCapacity"), "RUNTIME", pointer("reservedCapacity", ctx)));
      if (d.maximum.source === "DERIVED") {
        const derived = this.e.derived(d.maximum.statistic);
        if (derived !== null) {
          bindings.push(fromFragment(pointer("snapshot", "resources", String(i), "maximum"), derived));
          componentKeys.push(`derived.${d.maximum.statistic}`);
        }
      }
      return { resourceKey: ctx, kind: d.m4Kind, current: 0, minimum: d.minimum, maximum: d.maximum.source === "DERIVED" ? 0 : null, reservedCapacity: 0, provenance: entry.provenance as unknown as JsonObject };
    });
    return { template: { resources: states }, bindings, componentKeys };
  }

  /** The position of the next chain link. */
  position(): number {
    return this.links.length;
  }

  /**
   * Emits one chain step. `advance: false` (a payment PREVIEW) reads the same chain state as the step after it but
   * never becomes the chain head — a projection is never adopted as state.
   */
  step(input: {
    fragmentKey: string;
    offset: number;
    operation: EvaluationOperation;
    template: JsonObject;
    bindings: CompilationFragmentBinding[];
    role: string;
    componentKeys: string[];
    advance: boolean;
  }): string {
    const snapshot = this.snapshot();
    const componentKeys = [...new Set([...input.componentKeys, ...snapshot.componentKeys])];
    const fragmentKey = this.e.emit({
      fragmentKey: input.fragmentKey,
      order: chainOrder(this.position(), input.offset),
      operation: input.operation,
      input: { snapshot: snapshot.template, ...input.template },
      bindings: [...snapshot.bindings, ...input.bindings],
      role: input.role,
      componentKeys,
      definitions: this.cite(componentKeys),
    });
    if (input.advance) {
      this.links.push(fragmentKey);
      this.head = fragmentKey;
    }
    return fragmentKey;
  }

  /** A Resource transition link (SPEND / RESTORE / SET_CURRENT / RESERVE_CAPACITY / RELEASE_CAPACITY / REFRESH). */
  transition(key: RuntimeResourceKey, operation: "SPEND" | "RESTORE" | "SET_CURRENT" | "RESERVE_CAPACITY" | "RELEASE_CAPACITY" | "REFRESH", label: string, request: JsonObject, bindings: CompilationFragmentBinding[], extraComponents: string[] = []): string {
    const entry = this.resource(key);
    const owner = this.component("resource", key, entry);
    const fragmentKey = this.step({
      fragmentKey: `chain.${String(this.position())}.${label}.${key}`,
      offset: 5,
      operation: `RESOURCE_${operation}`,
      template: { request: { resourceKey: RESOURCE_CONTEXT_KEYS[key], ...request, provenance: entry.provenance as unknown as JsonObject } },
      bindings,
      role: `resource-${label}:${key}`,
      componentKeys: [owner, ...extraComponents],
      advance: true,
    });
    this.outputs.transitions.push({ resourceKey: key, operation, stepKey: fragmentKey });
    return fragmentKey;
  }

  /** A payment of an already-calculated listed amount from every Resource that pays `policy`, in authored order. */
  payment(costKey: string, policy: PaymentPolicy, listedAmount: number, owner: { componentKey: string; provenance: JsonObject | null }): void {
    const sources = paymentSourcesOf(this.index, policy);
    if (sources.length === 0) {
      this.p.add(R.INCONSISTENT_RUNTIME_DEFINITIONS, ["definitions"], `no RESOURCE Definition pays ${policy}`);
      return;
    }
    const sourceComponents = sources.map((s) => this.component("resource", s.entry.payload.resourceKey, s.entry));
    const template = {
      payment: {
        costKey,
        listedAmount,
        sources: sources.map((s) => ({ resourceKey: RESOURCE_CONTEXT_KEYS[s.entry.payload.resourceKey], order: s.order, limit: null, provenance: s.entry.provenance as unknown as JsonObject })),
        provenance: owner.provenance,
      },
    };
    const base = `chain.${String(this.position())}.${costKey}`;
    const componentKeys = [owner.componentKey, ...sourceComponents];
    const preview = this.step({ fragmentKey: `${base}.preview`, offset: 3, operation: "RESOURCE_PAYMENT_PREVIEW", template, bindings: [], role: `payment-preview:${policy}`, componentKeys, advance: false });
    const apply = this.step({ fragmentKey: `${base}.apply`, offset: 5, operation: "RESOURCE_PAYMENT_APPLY", template, bindings: [], role: `payment-apply:${policy}`, componentKeys, advance: true });
    this.outputs.payments.push({ costKey, policy, listedAmount, preview, apply });
  }

  /**
   * One Requirement per usage restriction of `key` (s51, s424): available unless the creature is surprised AND the
   * round is within the restricted rounds — NONE(ALL(surprised == 1, round <= throughRound)). Never a spend or a removal.
   */
  availability(key: RuntimeResourceKey): void {
    const entry = this.resource(key);
    if (entry.payload.usageRestrictions.length === 0) return;
    if (this.combat === null) {
      this.p.add(R.INVALID_RUNTIME_REQUEST, ["combat"], `${key} has usage restrictions (${entry.ref.canonicalKey}); combat timing { round, surprised } is required`);
      return;
    }
    const owner = this.component("resource", key, entry);
    const provenance = entry.provenance as unknown as JsonObject;
    for (const restriction of entry.payload.usageRestrictions) {
      const fragmentKey = this.e.emit({
        fragmentKey: `availability.${key}.${restriction.restrictionKey}`,
        order: availabilityOrder(this.outputs.availability.length),
        operation: "REQUIREMENT",
        input: {
          requirement: {
            kind: "NONE",
            children: [
              {
                kind: "ALL",
                children: [
                  { kind: "NUMERIC_COMPARE", factKey: RUNTIME_STATE_KEYS.SURPRISED, operator: "==", expected: SURPRISED_FACT_TRUE, provenance },
                  { kind: "NUMERIC_COMPARE", factKey: RUNTIME_STATE_KEYS.ROUND, operator: "<=", expected: restriction.throughRound, provenance },
                ],
                provenance,
              },
            ],
            provenance,
          },
          facts: { numeric: [{ key: RUNTIME_STATE_KEYS.SURPRISED, value: 0 }, { key: RUNTIME_STATE_KEYS.ROUND, value: 0 }] },
        },
        bindings: [fromContext("/facts/numeric/0/value", "RUNTIME", pointer("state", RUNTIME_STATE_KEYS.SURPRISED)), fromContext("/facts/numeric/1/value", "RUNTIME", pointer("state", RUNTIME_STATE_KEYS.ROUND))],
        role: `usage-availability:${restriction.restrictionKey}`,
        componentKeys: [owner],
        definitions: [entry.ref],
      });
      this.outputs.availability.push({ resourceKey: key, restrictionKey: restriction.restrictionKey, stepKey: fragmentKey });
    }
  }

  /**
   * An authored Formula (terrain cost, movement grant) as a pre-step of the next link. A MOVEMENT_DISTANCE variable is
   * the request's distance, copied as a literal input; a DERIVED variable is bound from its statistic's M4 step.
   */
  formula(fragmentKey: string, f: CoreFormula, owner: string, entry: CoreEntry<unknown>, distance: number | null): string {
    const bindings: CompilationFragmentBinding[] = [];
    const literals: Record<string, number> = {};
    const componentKeys = [owner];
    for (const { variable, source } of f.variables) {
      const target = pointer("variables", variable);
      if (source.kind === "MOVEMENT_DISTANCE" && distance !== null) literals[variable] = distance;
      else if (source.kind === "DERIVED") {
        const derived = this.e.derived(source.statistic);
        if (derived !== null) {
          bindings.push(fromFragment(target, derived));
          componentKeys.push(`derived.${source.statistic}`);
        }
      }
    }
    return this.e.emit({
      fragmentKey,
      order: chainOrder(this.position(), 1),
      operation: "FORMULA",
      input: { program: program(f, entry.provenance), variables: literals },
      bindings,
      role: fragmentKey.split(".").slice(2).join("."),
      componentKeys,
      definitions: this.cite(componentKeys),
    });
  }

  /**
   * Exposes "this Resource is at its minimum" from the chain's final state, for every involved Resource whose Definition
   * says so (HP: 0 HP). Downed / Death Saves are a later subsystem.
   */
  depletion(): void {
    const head = this.head;
    if (head === null) return;
    this.involved.forEach((key, position) => {
      const entry = this.resource(key);
      if (!entry.payload.exposesDepletion) return;
      const owner = this.component("resource", key, entry);
      const factKey = `${RESOURCE_CONTEXT_KEYS[key]}.current`;
      const stepKey = this.e.emit({
        fragmentKey: `depletion.${key}`,
        order: RUNTIME_ORDER.DEPLETION,
        operation: "REQUIREMENT",
        input: { requirement: { kind: "NUMERIC_COMPARE", factKey, operator: "==", expected: entry.payload.minimum, provenance: entry.provenance as unknown as JsonObject }, facts: { numeric: [{ key: factKey, value: 0 }] } },
        bindings: [fromFragment("/facts/numeric/0/value", head, `${SNAPSHOT_RESULT}/resources/${String(position)}/current`)],
        role: `resource-depleted:${key}`,
        componentKeys: [owner],
        definitions: [entry.ref],
      });
      this.outputs.depletion.push({ resourceKey: key, stepKey });
    });
  }
}

/** The AP listed amount of an action request, read from content or the explicit request — never computed. */
function actionPointAmount(action: CoreEntry<ActionDefinitionPayload>, subject: ActionPaymentSubject, p: Problems): number | null {
  const cost = action.payload.actionPointCost;
  const chosen = subject.actionPointCost;
  const at = ["subject", "actionPointCost"];
  const name = action.ref.canonicalKey;
  if (subject.costOverride !== undefined && (cost.model !== "FIXED" || !action.payload.costOverridableByExplicitRule)) {
    p.add(R.INVALID_ACTION_COST, ["subject", "costOverride"], `${name} has no explicitly overridable FIXED cost`);
    return null;
  }
  if (cost.model !== "VARIABLE" && subject.costSourceKey !== undefined) {
    p.add(R.INVALID_ACTION_COST, ["subject", "costSourceKey"], "costSourceKey names what determined a VARIABLE cost");
    return null;
  }
  switch (cost.model) {
    case "NONE":
      if (chosen !== undefined) p.add(R.INVALID_ACTION_COST, at, `${name} costs no AP`);
      return null;
    case "FIXED":
      if (chosen !== undefined) {
        p.add(R.INVALID_ACTION_COST, at, `${name} has a FIXED cost; change it only with an explicit costOverride`);
        return null;
      }
      return subject.costOverride === undefined ? cost.amount : subject.costOverride.amount;
    case "RANGE":
      if (chosen === undefined || chosen < cost.minimum || chosen > cost.maximum) {
        p.add(R.INVALID_ACTION_COST, at, `${name} costs between ${cost.minimum} and ${cost.maximum} AP; state the chosen cost explicitly`);
        return null;
      }
      return chosen;
    case "MINIMUM":
      if (chosen === undefined || chosen < cost.minimum) {
        p.add(R.INVALID_ACTION_COST, at, `${name} costs at least ${cost.minimum} AP; state the cost explicitly`);
        return null;
      }
      return chosen;
    case "VARIABLE":
      if (chosen === undefined || subject.costSourceKey === undefined) {
        p.add(R.INVALID_ACTION_COST, at, `${name} has a VARIABLE cost determined by ${cost.determinedBy}; supply the determined cost and its costSourceKey`);
        return null;
      }
      return chosen;
  }
}

/**
 * Compiles a runtime subject into an M4 EvaluationPlan (M5-WO3). Pure and deterministic: equal requests give deep-equal,
 * deep-frozen, JSON-safe plans; no input is mutated; nothing is persisted. Fails closed on an unsupported contract
 * version, a bundle that is not exactly the request's Ruleset bundle, missing / ambiguous Definitions, an invalid
 * CharacterCore, invalid runtime Resource state, a transition a Resource does not support, an invalid action request,
 * or a follow-on without a confirmed PAID receipt.
 */
export function compileRuntime(request: unknown): ProwessOutcome<ProwessRuntimeCompiledPlan> {
  const p = new Problems();
  if (!checkPlainData(request, [], p, C.NOT_PLAIN_DATA)) return finish(p, () => null as never);
  const r = readRecord(request, [], p, X.INVALID_REQUEST, REQUEST_FIELDS, ["contractVersion", "subject", "definitions", "ruleset", "character", "resources"]);
  if (r === null) return finish(p, () => null as never);
  const contractVersion = own(r, "contractVersion");
  if (typeof contractVersion !== "number" || !SUPPORTED_PROWESS_COMPILATION_CONTRACT_VERSIONS.includes(contractVersion)) {
    p.add(X.UNSUPPORTED_CONTRACT_VERSION, ["contractVersion"], `supported Prowess compilation contract versions: ${SUPPORTED_PROWESS_COMPILATION_CONTRACT_VERSIONS.join(", ")}`);
  }
  const subject = readSubject(own(r, "subject"), p);
  const resolved = readCoreBundle(r, p);
  if (p.count > 0 || subject === null || resolved === null) return finish(p, () => null as never);
  const { bundle, core } = resolved;
  const runtime = indexRuntimeDefinitions(bundle);
  if (!runtime.ok) return runtime as ProwessOutcome<never>;
  const index = runtime.value;
  const character = validateCharacterCore(own(r, "character"), core);
  if (!character.ok) {
    for (const problem of character.problems) p.list.push({ ...problem, path: `/character${problem.path}` });
    return finish(p, () => null as never);
  }
  const resources = validateRuntimeResources(own(r, "resources"), index);
  if (!resources.ok) {
    for (const problem of resources.problems) p.list.push({ ...problem, path: `/resources${problem.path}` });
    return finish(p, () => null as never);
  }
  let combat: CombatTiming | null = null;
  if (own(r, "combat") !== undefined) {
    const timing = validateCombatTiming(own(r, "combat"));
    if (!timing.ok) {
      for (const problem of timing.problems) p.list.push({ ...problem, path: `/combat${problem.path}` });
      return finish(p, () => null as never);
    }
    combat = timing.value;
  }

  const e = new Emitter(core, character.value, p);
  const chain = new RuntimeChain(e, index, resources.value, combat, p);
  let actionKey: string | null = null;
  let actionCanonicalKey: string | null = null;
  let event: CombatTimingEvent | null = null;

  switch (subject.kind) {
    case "RESOURCE_STATE": {
      const keys = subject.resources ?? resources.value.resources.map((s) => s.resourceKey);
      chain.involve(keys);
      if (p.count > 0) break;
      for (const key of keys) chain.transition(key, "SET_CURRENT", "state", { value: 0 }, [fromContext("/request/value", "RUNTIME", pointer("resourceValues", RESOURCE_CONTEXT_KEYS[key]))]);
      chain.depletion();
      break;
    }
    case "RESOURCE_TIMING": {
      event = subject.event;
      if (combat === null) {
        p.add(R.INVALID_TIMING, ["combat"], "a timing event needs the combat position { round, surprised }");
        break;
      }
      const preserved = subject.preserve ?? [];
      // Every SUPPLIED Resource with an authored refresh / expiry at this event; HP and MP have none (M5-I082, M5-I083).
      const supplied = resources.value.resources.map((x) => x.resourceKey);
      const timed = supplied.filter((key) => {
        const d = index.resources[key].payload;
        return d.refresh.some((x) => x.timing === subject.event) || d.expiry.some((x) => x.timing === subject.event);
      });
      for (const keep of preserved) {
        const rule = index.resources[keep.resourceKey].payload.expiry.find((x) => x.timing === subject.event);
        if (rule === undefined || !rule.preservableByExplicitRule) p.add(R.PRESERVATION_NOT_ALLOWED, ["subject", "preserve"], `${keep.resourceKey} has no explicitly preservable expiry at ${subject.event}`);
        else if (!supplied.includes(keep.resourceKey)) p.add(R.MISSING_RESOURCE_STATE, ["subject", "preserve"], `${keep.resourceKey} is preserved but its runtime state is not supplied`);
      }
      const acting = timed.filter((key) => !preserved.some((x) => x.resourceKey === key && index.resources[key].payload.refresh.every((rr) => rr.timing !== subject.event)));
      chain.involve(acting);
      if (p.count > 0) break;
      for (const key of acting) {
        const d = index.resources[key].payload;
        const refresh = d.refresh.find((x) => x.timing === subject.event);
        if (refresh !== undefined) chain.transition(key, "REFRESH", "refresh", { target: refresh.target }, []);
        else {
          const expiry = d.expiry.find((x) => x.timing === subject.event);
          if (expiry !== undefined) chain.transition(key, "SET_CURRENT", "expire", { value: d.minimum }, []);
        }
      }
      chain.outputs.preserved.push(...preserved.filter((x) => timed.includes(x.resourceKey)));
      for (const key of acting) chain.availability(key);
      break;
    }
    case "RESOURCE_TRANSITIONS": {
      subject.transitions.forEach((t, i) => {
        const d = index.resources[t.resourceKey].payload;
        const at = ["subject", "transitions", i, "operation"];
        const name = index.resources[t.resourceKey].ref.canonicalKey;
        if (t.operation === "SPEND" && d.spending !== "DIRECT") p.add(R.TRANSITION_NOT_SUPPORTED, at, `${t.resourceKey} is spent only through a payment that checks its usage (${name})`);
        if (t.operation === "RESTORE" && d.restoration === null) p.add(R.TRANSITION_NOT_SUPPORTED, at, `${t.resourceKey} has no generic restoration — it changes only at its authored timing (${name})`);
        if ((t.operation === "RESERVE_CAPACITY" || t.operation === "RELEASE_CAPACITY") && !d.supportsReservation) p.add(R.TRANSITION_NOT_SUPPORTED, at, `${t.resourceKey} does not support reserved capacity (${name})`);
      });
      chain.involve(subject.transitions.map((t) => t.resourceKey));
      if (p.count > 0) break;
      for (const t of subject.transitions) {
        const restoration = index.resources[t.resourceKey].payload.restoration;
        const request: JsonObject = t.operation === "RESTORE" && restoration !== null ? { amount: t.amount, ceiling: restoration.ceiling, overflow: restoration.overflow } : { amount: t.amount };
        chain.transition(t.resourceKey, t.operation, t.operation, request, []);
      }
      chain.depletion();
      break;
    }
    case "MAGICAL_PAYMENT": {
      const policy: PaymentPolicy = subject.meEligible ? "ME_ELIGIBLE_MAGICAL_COST" : "MAGICAL_COST";
      chain.involve(paymentSourcesOf(index, policy).map((s) => s.entry.payload.resourceKey));
      if (p.count > 0) break;
      const first = paymentSourcesOf(index, policy)[0];
      if (first === undefined) {
        p.add(R.INCONSISTENT_RUNTIME_DEFINITIONS, ["definitions"], `no RESOURCE Definition pays ${policy}`);
        break;
      }
      chain.payment(subject.costKey, policy, subject.listedAmount, { componentKey: chain.component("resource", first.entry.payload.resourceKey, first.entry), provenance: null });
      break;
    }
    case "ACTION_PAYMENT": {
      const action = index.actions[subject.actionKey];
      if (action === undefined) {
        p.add(R.UNKNOWN_ACTION, ["subject", "actionKey"], `the bundle has no ACTION Definition for ${subject.actionKey}`);
        break;
      }
      actionKey = action.payload.actionKey;
      actionCanonicalKey = action.ref.canonicalKey;
      if (action.payload.timing !== subject.window) p.add(R.ACTION_TIMING_MISMATCH, ["subject", "window"], `${action.ref.canonicalKey} is taken ${action.payload.timing}, not ${subject.window}`);
      if (action.payload.requiresTrigger && subject.trigger === undefined) p.add(R.TRIGGER_REQUIRED, ["subject", "trigger"], `${action.ref.canonicalKey} is used only when an explicit trigger permits it (s47, s434)`);
      if (!action.payload.requiresTrigger && subject.trigger !== undefined) p.add(R.INVALID_RUNTIME_REQUEST, ["subject", "trigger"], `${action.ref.canonicalKey} takes no trigger`);
      const amount = actionPointAmount(action, subject, p);
      if (p.count > 0) break;
      const costs: { costKey: string; policy: PaymentPolicy; amount: number }[] = [
        ...(amount === null ? [] : [{ costKey: "ACTION_POINTS", policy: "ACTION_POINT_COST" as const, amount }]),
        ...action.payload.otherCosts.map((c) => ({ costKey: c.costKey, policy: c.policy, amount: c.amount })),
      ];
      const payers = [...new Set(costs.flatMap((c) => paymentSourcesOf(index, c.policy).map((s) => s.entry.payload.resourceKey)))];
      chain.involve(payers);
      if (p.count > 0) break;
      const owner = chain.component("action", action.payload.actionKey, action);
      for (const key of payers) chain.availability(key);
      for (const cost of costs) chain.payment(cost.costKey, cost.policy, cost.amount, { componentKey: owner, provenance: action.provenance as unknown as JsonObject });
      break;
    }
    case "ACTION_FOLLOW_ON": {
      const receipt = readReceipt(subject.receipt, bundle, resources.value, p);
      if (receipt === null) break;
      const action = index.actions[receipt.actionKey];
      if (action === undefined || action.ref.canonicalKey !== receipt.actionCanonicalKey) {
        p.add(R.INVALID_PAYMENT_RECEIPT, ["subject", "receipt", "actionKey"], "the receipt names an action that is not in this exact bundle");
        break;
      }
      actionKey = action.payload.actionKey;
      actionCanonicalKey = action.ref.canonicalKey;
      const grant = action.payload.movementGrant;
      if (grant === null) break;
      chain.involve(["MOVEMENT_ALLOWANCE"]);
      if (p.count > 0) break;
      const owner = chain.component("action", action.payload.actionKey, action);
      const formula = chain.formula(`chain.${String(chain.position())}.movement-grant`, grant.formula, owner, action, null);
      chain.outputs.movementGrant = formula;
      const restoration = index.resources.MOVEMENT_ALLOWANCE.payload.restoration;
      if (restoration === null) {
        p.add(R.INCONSISTENT_RUNTIME_DEFINITIONS, ["definitions"], "the movement allowance Resource has no restoration rule to grant movement with");
        break;
      }
      chain.transition("MOVEMENT_ALLOWANCE", "RESTORE", "grant", { amount: 0, ceiling: restoration.ceiling, overflow: restoration.overflow }, [fromFragment("/request/amount", formula)], [owner]);
      break;
    }
    case "MOVEMENT": {
      chain.involve(["MOVEMENT_ALLOWANCE"]);
      const missing = subject.segments.filter((s) => index.terrains[s.terrainKey] === undefined);
      for (const s of missing) p.add(R.UNKNOWN_TERRAIN, ["subject", "segments"], `the bundle has no TERRAIN Definition for ${s.terrainKey}`);
      if (p.count > 0) break;
      subject.segments.forEach((segment) => {
        const terrain = index.terrains[segment.terrainKey] as CoreEntry<TerrainDefinitionPayload>;
        const owner = chain.component("terrain", segment.terrainKey, terrain);
        const cost = chain.formula(`chain.${String(chain.position())}.allowance-cost.${segment.terrainKey}`, terrain.payload.allowanceCost, owner, terrain, segment.distance);
        chain.outputs.movementCosts.push(cost);
        chain.transition("MOVEMENT_ALLOWANCE", "SPEND", "move", { amount: 0 }, [fromFragment("/request/amount", cost)], [owner]);
      });
      break;
    }
  }
  if (p.count > 0) return finish(p, () => null as never);

  const assembled = assembleFragments({ subjectKind: subject.kind, subjectKey: subject.subjectKey, components: e.components, bundle, fragments: e.fragments }, p);
  const stepKey = (fragmentKey: string) => compiledStepKey(subject.kind, subject.subjectKey, fragmentKey);
  const derived: Partial<Record<DerivedStatistic, string>> = {};
  for (const f of e.fragments) {
    const statistic = DERIVED_STATISTICS.find((s) => `derived.${s}` === f.fragmentKey);
    if (statistic !== undefined) derived[statistic] = stepKey(f.fragmentKey);
  }
  const finalResources: Partial<Record<RuntimeResourceKey, string>> = {};
  if (chain.head !== null) for (const key of chain.involved) finalResources[key] = stepKey(chain.head);
  const o = chain.outputs;
  return finish(p, () => ({
    contractVersion: PROWESS_COMPILATION_CONTRACT_VERSION,
    subject: { kind: subject.kind, subjectKey: subject.subjectKey, event, actionKey, actionCanonicalKey },
    rulesetProvenance: bundle.rulesetProvenance,
    evaluationPlan: { steps: assembled.steps, primaryStepKey: chain.head === null ? null : stepKey(chain.head), validationStepKey: null, explanationStepKey: null },
    sourceMap: { entries: assembled.entries },
    outputs: {
      resources: finalResources,
      transitions: o.transitions.map((t) => ({ ...t, stepKey: stepKey(t.stepKey) })),
      payments: o.payments.map((x) => ({ ...x, preview: stepKey(x.preview), apply: stepKey(x.apply) })),
      availability: o.availability.map((a) => ({ ...a, stepKey: stepKey(a.stepKey) })),
      preserved: o.preserved,
      movementGrant: o.movementGrant === null ? null : stepKey(o.movementGrant),
      movementCosts: o.movementCosts.map(stepKey),
      depletion: o.depletion.map((d) => ({ ...d, stepKey: stepKey(d.stepKey) })),
      derived,
    },
  }));
}

/**
 * A confirmed action payment (phase 1 → phase 2, §76). Only a PAID confirmation unlocks the action's follow-on; the
 * follow-on runs on exactly the Resource state the payment produced.
 */
export interface ActionPaymentReceipt {
  readonly status: "PAID";
  readonly actionKey: string;
  readonly actionCanonicalKey: string;
  readonly rulesetProvenance: ProwessRulesetProvenance;
  readonly resources: ProwessRuntimeResources;
}

function readReceipt(value: unknown, bundle: ProwessDefinitionBundle, resources: ProwessRuntimeResources, p: Problems): ActionPaymentReceipt | null {
  const at = ["subject", "receipt"];
  if (!isPlainObject(value) || own(value, "status") !== "PAID") {
    p.add(R.PAYMENT_NOT_CONFIRMED, at, "an action's follow-on is compiled only from a confirmed PAID receipt (confirmActionPayment) — a failed or unavailable payment grants nothing");
    return null;
  }
  const r = readRecord(value, at, p, R.INVALID_PAYMENT_RECEIPT, ["status", "actionKey", "actionCanonicalKey", "rulesetProvenance", "resources", "payments", "availability"], ["status", "actionKey", "actionCanonicalKey", "rulesetProvenance", "resources"]);
  if (r === null) return null;
  if (canonicalJsonOf(own(r, "rulesetProvenance")) !== canonicalJsonOf(bundle.rulesetProvenance)) {
    p.add(R.INVALID_PAYMENT_RECEIPT, [...at, "rulesetProvenance"], "the receipt was produced under a different exact Ruleset context");
    return null;
  }
  if (canonicalJsonOf(own(r, "resources")) !== canonicalJsonOf(resources)) {
    p.add(R.INVALID_PAYMENT_RECEIPT, [...at, "resources"], "the follow-on runs on exactly the Resource state the confirmed payment produced");
    return null;
  }
  if (!isToken(own(r, "actionKey")) || !isExactCanonicalKey(own(r, "actionCanonicalKey"))) {
    p.add(R.INVALID_PAYMENT_RECEIPT, at, "the receipt names its exact action");
    return null;
  }
  return { status: "PAID", actionKey: own(r, "actionKey") as string, actionCanonicalKey: own(r, "actionCanonicalKey") as string, rulesetProvenance: bundle.rulesetProvenance, resources };
}

/**
 * The exact M4 contexts a compiled runtime plan runs under: the character's ActorContext (its Stats feed the WO2
 * capacity statistics) and the RuntimeContext carrying the runtime Resource state and combat timing. Validated by the
 * same rules as compilation; nothing is rolled, refreshed or adjusted here.
 */
export function buildRuntimeContexts(input: {
  readonly definitions: ProwessDefinitionBundle;
  readonly character: unknown;
  readonly resources: unknown;
  readonly combat?: unknown;
}): ProwessOutcome<{ readonly actor: ActorContext; readonly runtime: RuntimeContext; readonly resources: ProwessRuntimeResources }> {
  const core = indexCoreDefinitions(input.definitions);
  if (!core.ok) return core as ProwessOutcome<never>;
  const index = indexRuntimeDefinitions(input.definitions);
  if (!index.ok) return index as ProwessOutcome<never>;
  const character = validateCharacterCore(input.character, core.value);
  if (!character.ok) return character as ProwessOutcome<never>;
  const actor = buildCharacterActorContext(character.value);
  if (!actor.ok) return actor as ProwessOutcome<never>;
  const resources = validateRuntimeResources(input.resources, index.value);
  if (!resources.ok) return resources as ProwessOutcome<never>;
  let combat: CombatTiming | null = null;
  if (input.combat !== undefined) {
    const timing = validateCombatTiming(input.combat);
    if (!timing.ok) return timing as ProwessOutcome<never>;
    combat = timing.value;
  }
  const runtime = buildRuntimeContext({ resources: resources.value, index: index.value, combat });
  if (!runtime.ok) return runtime as ProwessOutcome<never>;
  return finish(new Problems(), () => ({ actor: actor.value, runtime: runtime.value, resources: resources.value }));
}
