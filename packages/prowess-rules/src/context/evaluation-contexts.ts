import {
  InputProblems,
  readContextKey,
  readEntityVersionReferenceSet,
  readKeyedNumbers,
  readKeyedScalars,
  readKeySet,
  readOptionalEntityVersionReference,
  readOptionalText,
  readOrderedKeyedList,
  readRecord,
} from "../internal/input-reader.js";
import type { PathSegment } from "../internal/plain-data.js";
import { finishOutcome, type ContextOutcome, type ContextScalar, type EntityVersionReference } from "./shared.js";

/*
 * The three non-ruleset context families (PAS-10 M4-WO1 §11–13). Each is a GENERIC container: keyed collections and
 * exact references whose keys are caller-chosen context keys. None of them names a Prowess stat, rank, resource,
 * keyword or mechanic — those arrive later as data (Formulas, Requirements, Modifiers) that read these slots.
 *
 * Every field is always present in a normalized context; an empty collection means "nothing supplied". Each family is
 * independently constructible, and an evaluation supplies only the families it needs (§56).
 */

/**
 * The evaluating character / creature / object (§11).
 *
 *  - `actorRef`       opaque caller-supplied reference, carried for explanation only (null when not supplied)
 *  - `stats`          keyed finite numbers
 *  - `ranks`          keyed scalars (a rank may be numeric or a named tier)
 *  - `keywords`       set of keyword keys — metadata/rule hooks with NO implicit mechanics (§47)
 *  - `resources`      keyed authored/derived resource values of the actor (e.g. a pool's capacity). The CURRENT value
 *                     of a resource during play is runtime state and lives in `RuntimeContext.resourceValues` (§13)
 *  - `ownedEntities`  set of exact owned entity versions
 *  - `properties`     keyed scalars; `tags` a set of keys
 */
export interface ActorContext {
  readonly actorRef: string | null;
  readonly stats: Readonly<Record<string, number>>;
  readonly ranks: Readonly<Record<string, ContextScalar>>;
  readonly keywords: readonly string[];
  readonly resources: Readonly<Record<string, number>>;
  readonly ownedEntities: readonly EntityVersionReference[];
  readonly properties: Readonly<Record<string, ContextScalar>>;
  readonly tags: readonly string[];
}

/** One component of a build, addressed by a key unique within the build. */
export interface BuildComponent {
  readonly key: string;
  readonly reference: EntityVersionReference | null;
  readonly parameters: Readonly<Record<string, ContextScalar>>;
}

/**
 * The object being constructed or evaluated — a future Spell, Maneuver, Equipment or Summon build (§12). No builder
 * schema is implemented here.
 *
 *  - `buildKind`   generic context key naming the kind of build (e.g. `example.build`)
 *  - `components`  EXPLICITLY ORDERED (component order may carry meaning); keys unique
 *  - `parameters`, `properties`  keyed scalars; `keywords` a set of keys
 *  - `references`  set of exact entity versions the build refers to
 */
export interface BuildContext {
  readonly buildKind: string;
  readonly components: readonly BuildComponent[];
  readonly parameters: Readonly<Record<string, ContextScalar>>;
  readonly keywords: readonly string[];
  readonly properties: Readonly<Record<string, ContextScalar>>;
  readonly references: readonly EntityVersionReference[];
}

/** One active runtime effect instance, addressed by a key unique within the runtime context. */
export interface RuntimeEffect {
  readonly key: string;
  readonly reference: EntityVersionReference | null;
  readonly properties: Readonly<Record<string, ContextScalar>>;
}

/**
 * Transient play-time state (§13). A CONTAINER only — M4-WO1 implements no turns, casting, damage, conditions or
 * resource changes, and pure evaluation never mutates any of it (§49): an evaluator reads a frozen copy.
 *
 *  - `resourceValues`    keyed CURRENT resource values
 *  - `reservedCapacity`  keyed currently reserved amounts
 *  - `activeEffects`     EXPLICITLY ORDERED (application order may carry meaning later); keys unique
 *  - `conditions`        set of condition keys
 *  - `state`             keyed scalars for any other transient state
 */
export interface RuntimeContext {
  readonly resourceValues: Readonly<Record<string, number>>;
  readonly reservedCapacity: Readonly<Record<string, number>>;
  readonly activeEffects: readonly RuntimeEffect[];
  readonly conditions: readonly string[];
  readonly state: Readonly<Record<string, ContextScalar>>;
}

/** Internal readers (used directly and inside an evaluation request). `undefined` input means an empty container. */
export function readActorContext(value: unknown, at: readonly PathSegment[], p: InputProblems): ActorContext | null {
  const fields = ["actorRef", "stats", "ranks", "keywords", "resources", "ownedEntities", "properties", "tags"];
  const r = readRecord(value === undefined ? {} : value, at, p, fields);
  if (r === null) return null;
  return {
    actorRef: readOptionalText(r.actorRef, [...at, "actorRef"], p, 200),
    stats: readKeyedNumbers(r.stats, [...at, "stats"], p),
    ranks: readKeyedScalars(r.ranks, [...at, "ranks"], p),
    keywords: readKeySet(r.keywords, [...at, "keywords"], p),
    resources: readKeyedNumbers(r.resources, [...at, "resources"], p),
    ownedEntities: readEntityVersionReferenceSet(r.ownedEntities, [...at, "ownedEntities"], p),
    properties: readKeyedScalars(r.properties, [...at, "properties"], p),
    tags: readKeySet(r.tags, [...at, "tags"], p),
  };
}

function readComponent(value: unknown, at: readonly PathSegment[], p: InputProblems): BuildComponent | null {
  const r = readRecord(value, at, p, ["key", "reference", "parameters"], ["key"]);
  if (r === null) return null;
  const key = readContextKey(r.key, [...at, "key"], p);
  const reference = readOptionalEntityVersionReference(r.reference, [...at, "reference"], p);
  const parameters = readKeyedScalars(r.parameters, [...at, "parameters"], p);
  return key === null ? null : { key, reference, parameters };
}

export function readBuildContext(value: unknown, at: readonly PathSegment[], p: InputProblems): BuildContext | null {
  const fields = ["buildKind", "components", "parameters", "keywords", "properties", "references"];
  const r = readRecord(value, at, p, fields, ["buildKind"]);
  if (r === null) return null;
  const buildKind = r.buildKind === undefined ? null : readContextKey(r.buildKind, [...at, "buildKind"], p);
  const built = {
    components: readOrderedKeyedList(r.components, [...at, "components"], p, readComponent),
    parameters: readKeyedScalars(r.parameters, [...at, "parameters"], p),
    keywords: readKeySet(r.keywords, [...at, "keywords"], p),
    properties: readKeyedScalars(r.properties, [...at, "properties"], p),
    references: readEntityVersionReferenceSet(r.references, [...at, "references"], p),
  };
  return buildKind === null ? null : { buildKind, ...built };
}

function readEffect(value: unknown, at: readonly PathSegment[], p: InputProblems): RuntimeEffect | null {
  const r = readRecord(value, at, p, ["key", "reference", "properties"], ["key"]);
  if (r === null) return null;
  const key = readContextKey(r.key, [...at, "key"], p);
  const reference = readOptionalEntityVersionReference(r.reference, [...at, "reference"], p);
  const properties = readKeyedScalars(r.properties, [...at, "properties"], p);
  return key === null ? null : { key, reference, properties };
}

export function readRuntimeContext(value: unknown, at: readonly PathSegment[], p: InputProblems): RuntimeContext | null {
  const fields = ["resourceValues", "reservedCapacity", "activeEffects", "conditions", "state"];
  const r = readRecord(value === undefined ? {} : value, at, p, fields);
  if (r === null) return null;
  return {
    resourceValues: readKeyedNumbers(r.resourceValues, [...at, "resourceValues"], p),
    reservedCapacity: readKeyedNumbers(r.reservedCapacity, [...at, "reservedCapacity"], p),
    activeEffects: readOrderedKeyedList(r.activeEffects, [...at, "activeEffects"], p, readEffect),
    conditions: readKeySet(r.conditions, [...at, "conditions"], p),
    state: readKeyedScalars(r.state, [...at, "state"], p),
  };
}

/** Validates and normalizes a caller-supplied ActorContext. Omitted collections become empty. */
export function createActorContext(input: unknown = {}): ContextOutcome<ActorContext> {
  const p = new InputProblems();
  const value = readActorContext(input, [], p);
  return finishOutcome(p, () => value as ActorContext);
}

/** Validates and normalizes a caller-supplied BuildContext. `buildKind` is required; collections default to empty. */
export function createBuildContext(input: unknown): ContextOutcome<BuildContext> {
  const p = new InputProblems();
  const value = readBuildContext(input, [], p);
  return finishOutcome(p, () => value as BuildContext);
}

/** Validates and normalizes a caller-supplied RuntimeContext. Omitted collections become empty. */
export function createRuntimeContext(input: unknown = {}): ContextOutcome<RuntimeContext> {
  const p = new InputProblems();
  const value = readRuntimeContext(input, [], p);
  return finishOutcome(p, () => value as RuntimeContext);
}
