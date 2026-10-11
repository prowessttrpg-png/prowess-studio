/**
 * Reusable determinism / non-mutation checks for every M4 Work Order's tests (PAS-10 M4-WO1 §14, §51–52).
 *
 * Test support only — deliberately NOT exported from the package's public entry point, and framework-free (it throws
 * a plain Error rather than importing a test runner) so any M4 test file can call it.
 *
 * `assertDeterministic(run, { inputs })`:
 *  1. snapshots every input (canonical JSON) and, by default, DEEP-FREEZES them, so any attempted mutation throws;
 *  2. runs `run` several times;
 *  3. requires every output to serialize identically — byte for byte, key order included — and to be plain data;
 *  4. re-reads the first output after the runs and requires it to be unchanged (no lazy / hidden mutation);
 *  5. requires every input to still equal its snapshot.
 */
import { canonicalJson } from "../internal/canonical-json.js";
import { deepFreeze, inspectPlainData } from "../internal/plain-data.js";

export interface DeterminismOptions {
  /** Inputs that must not be mutated by `run`. */
  readonly inputs?: readonly unknown[];
  /** How many times to run (default 5, minimum 2). */
  readonly runs?: number;
  /** Deep-freeze the inputs before running (default true). */
  readonly freezeInputs?: boolean;
}

export function assertDeterministic<T>(run: () => T, options: DeterminismOptions = {}): T {
  const inputs = options.inputs ?? [];
  const runs = Math.max(2, options.runs ?? 5);
  const before = inputs.map((input) => canonicalJson(input));
  if (options.freezeInputs ?? true) for (const input of inputs) deepFreeze(input);

  const outputs: T[] = [];
  const serialized: string[] = [];
  for (let i = 0; i < runs; i += 1) {
    const output = run();
    const problems = inspectPlainData(output);
    if (problems.length > 0) throw new Error(`output is not plain data: ${JSON.stringify(problems)}`);
    outputs.push(output);
    serialized.push(JSON.stringify(output));
  }
  for (let i = 1; i < runs; i += 1) {
    if (serialized[i] !== serialized[0]) throw new Error(`run ${i + 1} differs from run 1:\n${serialized[0]}\n${serialized[i]}`);
  }
  if (JSON.stringify(outputs[0]) !== serialized[0]) throw new Error("the first output changed after being read again");
  inputs.forEach((input, i) => {
    if (canonicalJson(input) !== before[i]) throw new Error(`input ${i} was mutated`);
  });
  return outputs[0] as T;
}
