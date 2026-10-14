import type { EvaluationStep } from "@prowess/rules";

/** Syntax and outer shape only. Semantic validation belongs to the server. */
export function parseObject(text: string, label: string): Record<string, unknown> | null {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error(`${label}: invalid JSON syntax.`); }
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}: expected a JSON object or null.`);
  return value as Record<string, unknown>;
}

/** Display order only; code-unit comparison matches WO10 without locale-dependent sorting. */
export function orderedSteps<T extends Pick<EvaluationStep, "order" | "stepKey">>(steps: readonly T[]): T[] {
  return [...steps].sort((a, b) => a.order - b.order || (a.stepKey < b.stepKey ? -1 : a.stepKey > b.stepKey ? 1 : 0));
}

/** A detached, deeply frozen request snapshot; no rule evaluation or transformations. */
export function snapshotRequest<T>(value: T): T {
  const copy = JSON.parse(JSON.stringify(value)) as T;
  const stack: unknown[] = [copy];
  while (stack.length) {
    const item = stack.pop();
    if (item !== null && typeof item === "object") {
      stack.push(...Object.values(item));
      Object.freeze(item);
    }
  }
  return copy;
}
