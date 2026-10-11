import type { EntityId, EntityVersionId } from "@prowess/model";
import { toEngineErrors, type EngineError } from "../errors/engine-error.js";
import type { InputProblems } from "../internal/input-reader.js";
import { deepFreeze } from "../internal/plain-data.js";

/** A scalar value in a generic keyed context collection. */
export type ContextScalar = number | string | boolean;

/**
 * An exact `(Entity, EntityVersion)` pair — the immutable identity of one versioned rule or owned thing. Identity is
 * always the immutable ids, never a canonical key (PAS-10 M4-WO1 §10).
 */
export interface EntityVersionReference {
  readonly entityId: EntityId;
  readonly entityVersionId: EntityVersionId;
}

/**
 * The result of constructing a context or request from caller input: either the normalized, deep-frozen value, or
 * every structural problem found (in deterministic walk order). Construction never throws for bad input.
 */
export type ContextOutcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly EngineError[] };

/** Internal: turn collected problems or a built value into an outcome. `build` runs only when there are no problems. */
export function finishOutcome<T>(problems: InputProblems, build: () => T): ContextOutcome<T> {
  if (problems.count > 0) return deepFreeze({ ok: false as const, errors: toEngineErrors(problems.list) });
  return { ok: true as const, value: deepFreeze(build()) };
}
