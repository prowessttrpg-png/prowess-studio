import { isValidContextKey } from "../context/context-key.js";
import { canonicalJson } from "../internal/canonical-json.js";
import { InputProblems } from "../internal/input-reader.js";
import { deepFreeze, isPlainObject, jsonPointer } from "../internal/plain-data.js";
import { readProvenance } from "../result/provenance.js";
import { isExactLabel, validateRequirement } from "../requirement/validate.js";
import {
  MODIFIER_BOUNDARY_POLICIES,
  MODIFIER_DIAGNOSTIC_CODES,
  MODIFIER_LIMITS,
  MODIFIER_NUMERIC_OPERATIONS,
  MODIFIER_OPERATIONS,
  MODIFIER_SIGNAL_OPERATIONS,
  MODIFIER_STEP_OPERATIONS,
  type ModifierDefinition,
  type ModifierDiagnostic,
  type ModifierDiagnosticCode,
  type ModifierOperation,
  type ModifierSource,
  type ModifierStacking,
  type ModifierTarget,
  type ModifierTargetKind,
} from "./model.js";

/**
 * Local Modifier validation (PAS-10 M4-WO6 §9–13, §30–40, §61–65, §85, §94). Structure only — conditions are checked by
 * M4-WO5's `validateRequirement`, evaluated later. Not the M4-WO8 Validation Engine.
 *
 * Diagnostics: request shape, then targets and modifiers in input order, then grouped conflicts (duplicate keys, phase
 * conflicts) in sorted key order so they never depend on input order.
 */
export interface ModifierRequest {
  readonly targets: readonly ModifierTarget[];
  /** Sorted into application order: phaseOrder, priority, order, modifierKey (code units). */
  readonly modifiers: readonly ModifierDefinition[];
}

export type ModifierValidation =
  | { readonly ok: true; readonly request: ModifierRequest }
  | { readonly ok: false; readonly diagnostics: readonly ModifierDiagnostic[] };

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const zero = (n: number) => (Object.is(n, -0) ? 0 : n);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const isFinite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A plain object whose keys are all own data properties within `allowed` (getters are never invoked). */
function ownRecord(value: unknown, allowed: readonly string[]): value is Record<string, unknown> {
  if (!isPlainObject(value) || Object.getOwnPropertySymbols(value).length > 0) return false;
  return Object.keys(value).every((k) => {
    const d = Object.getOwnPropertyDescriptor(value, k);
    return allowed.includes(k) && d !== undefined && d.get === undefined && d.set === undefined;
  });
}

const FAMILY: Readonly<Record<ModifierOperation, ModifierTargetKind>> = {
  ...(Object.fromEntries(MODIFIER_NUMERIC_OPERATIONS.map((o) => [o, "NUMERIC"])) as Record<(typeof MODIFIER_NUMERIC_OPERATIONS)[number], "NUMERIC">),
  ...(Object.fromEntries(MODIFIER_STEP_OPERATIONS.map((o) => [o, "ORDERED"])) as Record<(typeof MODIFIER_STEP_OPERATIONS)[number], "ORDERED">),
  ...(Object.fromEntries(MODIFIER_SIGNAL_OPERATIONS.map((o) => [o, "ROLL_SIGNAL"])) as Record<(typeof MODIFIER_SIGNAL_OPERATIONS)[number], "ROLL_SIGNAL">),
};
export const operationFamily = (operation: ModifierOperation): ModifierTargetKind => FAMILY[operation];

const TARGET_FIELDS: Readonly<Record<ModifierTargetKind, readonly string[]>> = {
  NUMERIC: ["targetKey", "kind", "value"],
  ORDERED: ["targetKey", "kind", "currentKey", "steps", "boundaryPolicy"],
  ROLL_SIGNAL: ["targetKey", "kind"],
};
const MODIFIER_FIELDS = ["modifierKey", "targetKey", "operation", "operand", "phase", "priority", "order", "condition", "stacking", "source", "provenance"];

/** Public validation: the frozen normalized request, or every diagnostic. */
export function validateModifiers(input: unknown): ModifierValidation {
  const result = validateModifiersWithIndex(input);
  return result.ok ? deepFreeze({ ok: true as const, request: result.request }) : result;
}

/**
 * Internal: validation plus each modifierKey's position in the caller's `modifiers` array, so evaluation-time
 * diagnostics can point (RFC 6901) at the exact input element.
 */
export function validateModifiersWithIndex(
  input: unknown,
): { readonly ok: true; readonly request: ModifierRequest; readonly inputIndex: ReadonlyMap<string, number> } | { readonly ok: false; readonly diagnostics: readonly ModifierDiagnostic[] } {
  const diagnostics: ModifierDiagnostic[] = [];
  const report = (code: ModifierDiagnosticCode, message: string, path: readonly (string | number)[], extra: Partial<ModifierDiagnostic> = {}) =>
    diagnostics.push({ code, message, path: jsonPointer(path), modifierKey: null, requirementCode: null, provenance: null, ...extra });
  const fail = () => deepFreeze({ ok: false as const, diagnostics });

  if (!ownRecord(input, ["targets", "modifiers", "facts"]) || !Array.isArray(input.targets) || !Array.isArray(input.modifiers)) {
    report(MODIFIER_DIAGNOSTIC_CODES.INVALID_DEFINITION, "a modifier request is { targets[], modifiers[], facts? } — plain data only", []);
    return fail();
  }
  if (input.targets.length > MODIFIER_LIMITS.MAX_TARGETS) {
    report(MODIFIER_DIAGNOSTIC_CODES.LIMIT_EXCEEDED, `at most ${MODIFIER_LIMITS.MAX_TARGETS} targets`, ["targets"]);
    return fail();
  }
  if (input.modifiers.length > MODIFIER_LIMITS.MAX_MODIFIERS) {
    report(MODIFIER_DIAGNOSTIC_CODES.LIMIT_EXCEEDED, `at most ${MODIFIER_LIMITS.MAX_MODIFIERS} modifiers`, ["modifiers"]);
    return fail();
  }

  // 1. Targets, in input order.
  const targets: ModifierTarget[] = [];
  input.targets.forEach((t: unknown, i: number) => {
    const at = ["targets", i];
    const kind = isPlainObject(t) ? t.kind : undefined;
    if (typeof kind !== "string" || !(kind in TARGET_FIELDS) || !ownRecord(t, TARGET_FIELDS[kind as ModifierTargetKind])) {
      report(MODIFIER_DIAGNOSTIC_CODES.INVALID_TARGET, "a target is a plain { targetKey, kind: NUMERIC | ORDERED | ROLL_SIGNAL, … } with no other fields", at);
      return;
    }
    if (!isValidContextKey(t.targetKey)) {
      report(MODIFIER_DIAGNOSTIC_CODES.INVALID_TARGET, "targetKey must be an exact context key", [...at, "targetKey"]);
      return;
    }
    const targetKey = t.targetKey;
    if (kind === "NUMERIC") {
      if (!isFinite(t.value)) return void report(MODIFIER_DIAGNOSTIC_CODES.INVALID_TARGET, "a NUMERIC target value must be a finite number", [...at, "value"]);
      targets.push({ targetKey, kind, value: zero(t.value) });
    } else if (kind === "ORDERED") {
      if (!Array.isArray(t.steps) || t.steps.length === 0) return void report(MODIFIER_DIAGNOSTIC_CODES.INVALID_TARGET, "steps must be a non-empty ladder", [...at, "steps"]);
      if (t.steps.length > MODIFIER_LIMITS.MAX_STEPS_PER_TARGET) {
        return void report(MODIFIER_DIAGNOSTIC_CODES.LIMIT_EXCEEDED, `at most ${MODIFIER_LIMITS.MAX_STEPS_PER_TARGET} steps per target`, [...at, "steps"]);
      }
      const steps = t.steps as unknown[];
      if (!steps.every(isExactLabel)) return void report(MODIFIER_DIAGNOSTIC_CODES.INVALID_TARGET, "every step must be an exact non-empty label", [...at, "steps"]);
      if (new Set(steps).size !== steps.length) return void report(MODIFIER_DIAGNOSTIC_CODES.INVALID_TARGET, "step keys must be unique", [...at, "steps"]);
      if (!isExactLabel(t.currentKey) || !steps.includes(t.currentKey)) {
        return void report(MODIFIER_DIAGNOSTIC_CODES.INVALID_TARGET, "currentKey must be exactly one of the steps", [...at, "currentKey"]);
      }
      if (!(MODIFIER_BOUNDARY_POLICIES as readonly unknown[]).includes(t.boundaryPolicy)) {
        return void report(MODIFIER_DIAGNOSTIC_CODES.INVALID_TARGET, "boundaryPolicy must be CLAMP or INVALID (no default)", [...at, "boundaryPolicy"]);
      }
      targets.push({ targetKey, kind, currentKey: t.currentKey, steps: [...(steps as string[])], boundaryPolicy: t.boundaryPolicy as "CLAMP" });
    } else {
      targets.push({ targetKey, kind: "ROLL_SIGNAL" });
    }
  });
  const targetKind = new Map<string, ModifierTargetKind>();
  const seenTargets = new Map<string, number>();
  for (const t of targets) seenTargets.set(t.targetKey, (seenTargets.get(t.targetKey) ?? 0) + 1);
  for (const key of [...seenTargets.keys()].sort(byCodeUnit)) {
    if ((seenTargets.get(key) as number) > 1) report(MODIFIER_DIAGNOSTIC_CODES.DUPLICATE_KEY, `targetKey "${key}" is supplied more than once`, ["targets"]);
  }
  for (const t of targets) targetKind.set(t.targetKey, t.kind);

  // 2. Modifiers, in input order.
  const modifiers: ModifierDefinition[] = [];
  const inputIndex = new Map<string, number>();
  input.modifiers.forEach((m: unknown, i: number) => {
    const at = ["modifiers", i];
    if (!ownRecord(m, MODIFIER_FIELDS)) {
      report(MODIFIER_DIAGNOSTIC_CODES.INVALID_DEFINITION, `a modifier is a plain object with only ${MODIFIER_FIELDS.join(", ")}`, at);
      return;
    }
    const modifierKey = isExactLabel(m.modifierKey) ? m.modifierKey : null;
    const bad = (code: ModifierDiagnosticCode, message: string, field: string) =>
      report(code, message, [...at, field], { modifierKey, provenance: null });
    const before = diagnostics.length;

    if (modifierKey === null) bad(MODIFIER_DIAGNOSTIC_CODES.INVALID_DEFINITION, "modifierKey must be an exact non-empty label", "modifierKey");
    const operation = (MODIFIER_OPERATIONS as readonly unknown[]).includes(m.operation) ? (m.operation as ModifierOperation) : null;
    if (operation === null) bad(MODIFIER_DIAGNOSTIC_CODES.INVALID_DEFINITION, `operation must be one of ${MODIFIER_OPERATIONS.join(", ")} (no CUSTOM, callback or game-specific operation)`, "operation");

    let targetKey: string | null = null;
    if (!isValidContextKey(m.targetKey)) bad(MODIFIER_DIAGNOSTIC_CODES.INVALID_TARGET, "targetKey must be an exact context key", "targetKey");
    else if (!targetKind.has(m.targetKey)) bad(MODIFIER_DIAGNOSTIC_CODES.INVALID_TARGET, `target "${m.targetKey}" was not supplied (targets are never created)`, "targetKey");
    else targetKey = m.targetKey;
    if (operation !== null && targetKey !== null && targetKind.get(targetKey) !== operationFamily(operation)) {
      bad(MODIFIER_DIAGNOSTIC_CODES.TARGET_TYPE_MISMATCH, `${operation} needs a ${operationFamily(operation)} target; "${targetKey}" is ${String(targetKind.get(targetKey))}`, "operation");
    }

    let operand: number | null = null;
    if (operation !== null) {
      const family = operationFamily(operation);
      if (family === "ROLL_SIGNAL") {
        if ("operand" in m) bad(MODIFIER_DIAGNOSTIC_CODES.INVALID_OPERAND, `${operation} takes no operand`, "operand");
      } else if (family === "ORDERED") {
        if (!isInt(m.operand) || m.operand < 1) bad(MODIFIER_DIAGNOSTIC_CODES.INVALID_OPERAND, `${operation} needs a whole number of steps of at least 1`, "operand");
        else operand = m.operand;
      } else if (!isFinite(m.operand)) {
        bad(MODIFIER_DIAGNOSTIC_CODES.INVALID_OPERAND, `${operation} needs a finite number operand`, "operand");
      } else if ((operation === "INCREASE_PERCENT" || operation === "REDUCE_PERCENT") && m.operand < 0) {
        bad(MODIFIER_DIAGNOSTIC_CODES.INVALID_OPERAND, `${operation} needs a percentage of at least 0`, "operand");
      } else if (operation === "DIVIDE" && m.operand === 0) {
        bad(MODIFIER_DIAGNOSTIC_CODES.DIVISION_BY_ZERO, "DIVIDE by zero", "operand");
      } else operand = zero(m.operand);
    }

    const phase = m.phase;
    if (!ownRecord(phase, ["phaseKey", "phaseOrder"]) || !isExactLabel(phase.phaseKey) || !isInt(phase.phaseOrder)) {
      bad(MODIFIER_DIAGNOSTIC_CODES.INVALID_DEFINITION, "phase must be { phaseKey: exact label, phaseOrder: integer }", "phase");
    }
    if (!isInt(m.priority)) bad(MODIFIER_DIAGNOSTIC_CODES.INVALID_DEFINITION, "priority must be an integer", "priority");
    if (!isInt(m.order)) bad(MODIFIER_DIAGNOSTIC_CODES.INVALID_DEFINITION, "order must be an integer", "order");

    let stacking: ModifierStacking = { policy: "STACK" };
    if (m.stacking !== undefined) {
      const st = m.stacking;
      if (ownRecord(st, ["policy"]) && st.policy === "STACK") stacking = { policy: "STACK" };
      else if (ownRecord(st, ["policy", "stackingKey"]) && st.policy === "UNIQUE" && isExactLabel(st.stackingKey)) stacking = { policy: "UNIQUE", stackingKey: st.stackingKey };
      else bad(MODIFIER_DIAGNOSTIC_CODES.INVALID_DEFINITION, "stacking must be { policy: STACK } or { policy: UNIQUE, stackingKey }", "stacking");
    }

    let source: ModifierSource | null = null;
    if (m.source !== undefined && m.source !== null) {
      const s = m.source;
      if (!ownRecord(s, ["sourceType", "sourceKey", "sourceId"]) || !isValidContextKey(s.sourceType) || !isExactLabel(s.sourceKey) || !(s.sourceId === undefined || s.sourceId === null || isExactLabel(s.sourceId))) {
        bad(MODIFIER_DIAGNOSTIC_CODES.INVALID_DEFINITION, "source must be { sourceType: context key, sourceKey, sourceId? }", "source");
      } else source = { sourceType: s.sourceType, sourceKey: s.sourceKey, sourceId: (s.sourceId as string | undefined) ?? null };
    }
    const problems = new InputProblems();
    const provenance = readProvenance(m.provenance, [], problems);
    if (problems.count > 0) bad(MODIFIER_DIAGNOSTIC_CODES.INVALID_DEFINITION, "provenance is malformed", "provenance");

    let condition = null;
    if (m.condition !== undefined && m.condition !== null) {
      const v = validateRequirement(m.condition, [...at, "condition"]);
      if (v.ok) condition = v.requirement;
      else {
        for (const d of v.diagnostics) {
          diagnostics.push({ code: MODIFIER_DIAGNOSTIC_CODES.INVALID_CONDITION, message: d.message, path: d.path, modifierKey, requirementCode: d.code, provenance: d.provenance });
        }
      }
    }
    if (diagnostics.length > before) return;
    if (!inputIndex.has(modifierKey as string)) inputIndex.set(modifierKey as string, i);
    modifiers.push({
      modifierKey: modifierKey as string,
      targetKey: targetKey as string,
      operation: operation as ModifierOperation,
      operand,
      phase: { phaseKey: (phase as { phaseKey: string }).phaseKey, phaseOrder: zero((phase as { phaseOrder: number }).phaseOrder) },
      priority: zero(m.priority as number),
      order: zero(m.order as number),
      condition,
      stacking,
      source,
      provenance,
    });
  });

  // 3. Grouped conflicts, in sorted key order.
  const byKey = new Map<string, ModifierDefinition[]>();
  for (const m of modifiers) byKey.set(m.modifierKey, [...(byKey.get(m.modifierKey) ?? []), m]);
  const unique: ModifierDefinition[] = [];
  for (const key of [...byKey.keys()].sort(byCodeUnit)) {
    const variants = byKey.get(key) as ModifierDefinition[];
    if (new Set(variants.map((v) => canonicalJson(v))).size > 1) {
      report(MODIFIER_DIAGNOSTIC_CODES.DUPLICATE_KEY, `modifierKey "${key}" is supplied with conflicting definitions`, ["modifiers"], { modifierKey: key });
      continue;
    }
    unique.push(variants[0] as ModifierDefinition); // identical duplicates collapse
  }
  const phaseOrders = new Map<string, Set<number>>();
  for (const m of unique) phaseOrders.set(m.phase.phaseKey, (phaseOrders.get(m.phase.phaseKey) ?? new Set<number>()).add(m.phase.phaseOrder));
  for (const phaseKey of [...phaseOrders.keys()].sort(byCodeUnit)) {
    const orders = phaseOrders.get(phaseKey) as Set<number>;
    if (orders.size > 1) report(MODIFIER_DIAGNOSTIC_CODES.PHASE_CONFLICT, `phase "${phaseKey}" is given ${orders.size} different phaseOrders`, ["modifiers"]);
  }
  if (diagnostics.length > 0) return fail();

  const ordered = unique.sort(
    (a, b) => a.phase.phaseOrder - b.phase.phaseOrder || a.priority - b.priority || a.order - b.order || byCodeUnit(a.modifierKey, b.modifierKey),
  );
  // The caller's facts are deliberately NOT part of the request: freezing them would mutate caller input.
  const request = deepFreeze({ targets: [...targets].sort((a, b) => byCodeUnit(a.targetKey, b.targetKey)), modifiers: ordered });
  return { ok: true as const, request, inputIndex };
}
