import type { JsonObject } from "@prowess/model";
import { EVALUATION_CONTEXT_FAMILIES, EVALUATION_OPERATIONS, type EvaluationBinding, type EvaluationStep } from "@prowess/rules";
import { clonePlainData, isPlainObject, type PathSegment } from "../internal/plain-data.js";
import { Problems, checkPlainData, finish, isExactLabel, own, readEnum, readRecord, readSafeInteger, type ProwessOutcome } from "../internal/problems.js";
import { COMPILATION_ERROR_CODES as X, DEFINITION_ERROR_CODES as C } from "../definition/codes.js";
import { isSameExactDefinition, readDefinitionRef, type ProwessDefinitionRef } from "../definition/envelope.js";
import { findBundleDefinition, type ProwessDefinitionBundle } from "../bundle/bundle.js";
import { compositionComponents, type AbilityComposition } from "../construction/composition.js";
import { PROWESS_COMPILATION_CONTRACT_VERSION } from "../contract-version.js";
import type { CompilationFragment, ProwessCompiledPlan, ProwessSourceMapEntry } from "./model.js";

/**
 * Deterministic step identity (PAS-10 M5-WO1 §102, M5-I013): derived only from the AbilityKind, the Composition key and
 * the fragment's local key — never a random suffix, a clock value or an object identity.
 */
export function compiledStepKey(subjectKind: string, subjectKey: string, fragmentKey: string): string {
  return ["prowess", subjectKind, subjectKey, fragmentKey].join(":");
}

/**
 * The domain origin a fragment may cite: each component key of the subject and the exact Definition(s) it uses. For an
 * Ability this is the Composition's component uses; for a core-resolution subject (M5-WO2) it is the role-indexed
 * core Definitions the compiler resolved.
 */
export type SubjectComponents = ReadonlyMap<string, readonly ProwessDefinitionRef[]>;

export interface AssembledSteps {
  readonly steps: EvaluationStep[];
  readonly entries: ProwessSourceMapEntry[];
}

const FRAGMENT_FIELDS = ["fragmentKey", "order", "operation", "input", "bindings", "role", "componentKeys", "definitions"];

/**
 * Assembles component-compiler fragments into an M4 EvaluationPlan plus its source map. Pure assembly only (§106):
 * it copies authored input templates, rewrites fragment references to deterministic step keys and orders steps by
 * their explicit `order` (ties broken by stepKey, exactly as M4 executes them). It performs no calculation (§107).
 *
 * Every fragment must trace to at least one component of THIS Composition and only cite exact Definitions those
 * components use (M5-I014). Fragment references must point to an earlier-ordered fragment.
 */
export function assembleCompiledPlan(input: {
  readonly composition: AbilityComposition;
  readonly bundle: ProwessDefinitionBundle;
  readonly fragments: readonly unknown[];
}): ProwessOutcome<ProwessCompiledPlan> {
  const { composition, bundle } = input;
  const components: SubjectComponents = new Map(compositionComponents(composition).map((c) => [c.use.componentKey, [c.use.definition]]));
  const p = new Problems();
  const assembled = assembleFragments({ subjectKind: composition.abilityKind, subjectKey: composition.compositionKey, components, bundle, fragments: input.fragments }, p);
  return finish(p, () => ({
    contractVersion: PROWESS_COMPILATION_CONTRACT_VERSION,
    subject: { kind: composition.abilityKind, compositionKey: composition.compositionKey },
    rulesetProvenance: bundle.rulesetProvenance,
    evaluationPlan: { steps: assembled.steps, primaryStepKey: null, validationStepKey: null, explanationStepKey: null },
    sourceMap: { entries: assembled.entries },
  }));
}

/**
 * Subject-neutral assembly shared by every Prowess compiler (Abilities in WO1, core resolution in WO2): validates the
 * fragments, maps every one to the subject's components and exact Definitions, rewrites fragment references to
 * deterministic step keys and orders steps exactly as M4 executes them. Problems are recorded in `p`.
 */
export function assembleFragments(
  input: { readonly subjectKind: string; readonly subjectKey: string; readonly components: SubjectComponents; readonly bundle: ProwessDefinitionBundle; readonly fragments: readonly unknown[] },
  p: Problems,
): AssembledSteps {
  const { bundle } = input;
  if (!checkPlainData(input.fragments, ["fragments"], p, C.NOT_PLAIN_DATA)) return { steps: [], entries: [] };

  const uses = input.components;
  const fragments: CompilationFragment[] = [];
  const keys = new Map<string, number>();

  input.fragments.forEach((raw: unknown, i: number) => {
    const at: PathSegment[] = ["fragments", i];
    const r = readRecord(raw, at, p, X.INVALID_FRAGMENT, FRAGMENT_FIELDS, FRAGMENT_FIELDS);
    if (r === null) return;
    const before = p.count;
    const fragmentKey = own(r, "fragmentKey");
    if (!isExactLabel(fragmentKey)) p.add(X.INVALID_FRAGMENT, [...at, "fragmentKey"], "fragmentKey is an exact label");
    else if (keys.has(fragmentKey)) p.add(X.DUPLICATE_STEP, [...at, "fragmentKey"], `fragmentKey "${fragmentKey}" is emitted twice`);
    const order = readSafeInteger(own(r, "order"), [...at, "order"], p, X.INVALID_FRAGMENT, "order");
    const operation = readEnum(own(r, "operation"), EVALUATION_OPERATIONS, [...at, "operation"], p, X.INVALID_FRAGMENT, "M4 operation");
    const role = own(r, "role");
    if (!isExactLabel(role)) p.add(X.INVALID_FRAGMENT, [...at, "role"], "role is an exact label");
    const template = own(r, "input");
    if (!isPlainObject(template)) p.add(X.INVALID_FRAGMENT, [...at, "input"], "input is a plain-data M4 operation template");

    const componentKeys = own(r, "componentKeys");
    if (!Array.isArray(componentKeys) || componentKeys.length === 0 || !componentKeys.every((k: unknown) => typeof k === "string" && uses.has(k))) {
      p.add(X.UNMAPPED_SOURCE, [...at, "componentKeys"], "every compiled step names at least one component of this Composition");
    }
    const rawDefinitions = own(r, "definitions");
    const definitions: ProwessDefinitionRef[] = [];
    if (!Array.isArray(rawDefinitions)) p.add(X.INVALID_FRAGMENT, [...at, "definitions"], "definitions is an array of exact Definition references");
    else
      rawDefinitions.forEach((d: unknown, j: number) => {
        const ref = readDefinitionRef(d, [...at, "definitions", j], p, X.INVALID_FRAGMENT);
        if (ref === null) return;
        const usedBy = Array.isArray(componentKeys) && componentKeys.some((k: unknown) => typeof k === "string" && (uses.get(k) ?? []).some((used) => isSameExactDefinition(used, ref)));
        if (!usedBy || findBundleDefinition(bundle, ref) === null) {
          p.add(X.UNMAPPED_SOURCE, [...at, "definitions", j], "a step may only cite exact bundle Definitions used by its own components");
          return;
        }
        definitions.push(ref);
      });

    const rawBindings = own(r, "bindings");
    const bindings: CompilationFragment["bindings"][number][] = [];
    if (!Array.isArray(rawBindings)) p.add(X.INVALID_FRAGMENT, [...at, "bindings"], "bindings is an array");
    else
      rawBindings.forEach((b: unknown, j: number) => {
        const bat = [...at, "bindings", j];
        const br = readRecord(b, bat, p, X.INVALID_FRAGMENT, ["target", "source"], ["target", "source"]);
        const src = br === null ? null : own(br, "source");
        if (br === null || typeof own(br, "target") !== "string" || !isPlainObject(src) || typeof own(src, "pointer") !== "string") {
          if (br !== null) p.add(X.INVALID_FRAGMENT, bat, "a binding is { target, source: { kind, …, pointer } }");
          return;
        }
        if (own(src, "kind") === "CONTEXT") {
          const context = readEnum(own(src, "context"), EVALUATION_CONTEXT_FAMILIES, [...bat, "source", "context"], p, X.INVALID_FRAGMENT, "context family");
          if (context !== null) bindings.push({ target: own(br, "target") as string, source: { kind: "CONTEXT", context, pointer: own(src, "pointer") as string } });
        } else if (own(src, "kind") === "FRAGMENT" && isExactLabel(own(src, "fragmentKey"))) {
          bindings.push({ target: own(br, "target") as string, source: { kind: "FRAGMENT", fragmentKey: own(src, "fragmentKey") as string, pointer: own(src, "pointer") as string } });
        } else p.add(X.INVALID_FRAGMENT, [...bat, "source"], "source kind is CONTEXT or FRAGMENT");
      });

    if (p.count > before || order === null || operation === null) return;
    keys.set(fragmentKey as string, order);
    fragments.push({
      fragmentKey: fragmentKey as string,
      order,
      operation,
      input: clonePlainData(template as JsonObject),
      bindings,
      role: role as string,
      componentKeys: [...(componentKeys as string[])].sort(),
      definitions,
    });
  });

  const stepKey = (fragmentKey: string) => compiledStepKey(input.subjectKind, input.subjectKey, fragmentKey);
  fragments.forEach((f, i) =>
    f.bindings.forEach((b, j) => {
      if (b.source.kind !== "FRAGMENT") return;
      const target = keys.get(b.source.fragmentKey);
      if (target === undefined || !(target < f.order)) {
        p.add(X.UNKNOWN_STEP_REFERENCE, ["fragments", i, "bindings", j, "source"], "a binding may only read an earlier-ordered fragment of the same compilation");
      }
    }),
  );

  const ordered = [...fragments].sort((a, b) => {
    if (a.order !== b.order) return a.order < b.order ? -1 : 1;
    const ka = stepKey(a.fragmentKey);
    const kb = stepKey(b.fragmentKey);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  const steps: EvaluationStep[] = ordered.map((f) => ({
    stepKey: stepKey(f.fragmentKey),
    order: f.order,
    operation: f.operation,
    input: f.input,
    bindings: f.bindings.map(
      (b): EvaluationBinding =>
        b.source.kind === "CONTEXT" ? { target: b.target, source: b.source } : { target: b.target, source: { kind: "STEP", stepKey: stepKey(b.source.fragmentKey), pointer: b.source.pointer } },
    ),
  }));
  const entries: ProwessSourceMapEntry[] = ordered.map((f) => ({
    stepKey: stepKey(f.fragmentKey),
    order: f.order,
    operation: f.operation,
    role: f.role,
    componentKeys: f.componentKeys,
    definitions: f.definitions,
  }));

  return { steps, entries };
}
