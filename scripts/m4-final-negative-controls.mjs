/** WO12 real behavioral mutations. This script serially restores source in finally; never publish control code. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "packages/prowess-rules/src/orchestration/orchestrate.ts");
const original = readFileSync(file, "utf8");
const run = pattern => spawnSync(process.execPath, [path.join(root, "packages/prowess-rules/node_modules/vitest/vitest.mjs"), "run", "src/orchestration.test.ts", "-t", pattern], {cwd: path.join(root, "packages/prowess-rules"), encoding: "utf8", timeout: 60_000});
const baseline = run("false Requirement|listed 17");
assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);
const controls = [
  {name: "Requirement false auto-block", from: "if (prior.response === null) {", to: "if (prior.response === null || prior.response.data?.satisfied === false) {", test: "false Requirement"},
  {name: "Resource insufficiency auto-block", from: "if (prior.response === null) {", to: "if (prior.response === null || prior.response.data?.canPay === false) {", test: "false Requirement"},
  {name: "Payment incorrectly reduces listed value", from: "return applyResourcePayment(input.snapshot, input.payment, options);", to: "return applyResourcePayment(input.snapshot, { ...input.payment, listedAmount: input.payment.listedAmount - input.snapshot.resources[0].current }, options);", test: "listed 17"},
];
try {
  for (const control of controls) {
    assert.ok(original.includes(control.from), `mutation anchor missing: ${control.name}`);
    writeFileSync(file, original.replace(control.from, control.to));
    const failed = run(control.test);
    assert.notEqual(failed.status, 0, `control was not caught: ${control.name}`);
    assert.match(failed.stdout + failed.stderr, /AssertionError/, `control failed for infrastructure rather than behavior: ${control.name}`);
    console.log(`Negative control caught: ${control.name}`);
    writeFileSync(file, original);
  }
} finally { writeFileSync(file, original); }
assert.equal(readFileSync(file, "utf8"), original);
assert.equal(run("false Requirement|listed 17").status, 0, "positive baseline failed after restoration");

// Same complete semantic JSON across locale/timezone subprocesses, using trusted test fixture code only.
const fixture = ts.transpileModule(readFileSync(path.join(root, "apps/studio/app/developer/rules/_lib/sample.ts"), "utf8"), {compilerOptions: {module: ts.ModuleKind.ESNext}}).outputText;
const executable = `${fixture}\nimport { createRulesetContext, orchestrateRulesEvaluation } from ${JSON.stringify(pathToFileURL(path.join(root, "packages/prowess-rules/dist/index.js")).href)};
const context=createRulesetContext({rulesetId:"40000000-0000-4000-8000-000000000001",manifestId:"40000000-0000-4000-8000-000000000002",rules:[]});
if(!context.ok) throw new Error("invalid fixture");
process.stdout.write(JSON.stringify(orchestrateRulesEvaluation({evaluationKey:"audit.locale",contexts:{ruleset:context.value,actor:{stats:{divisor:4}}},plan:samplePlan()})));`;
const outputs = [
  {LANG: "en_US.UTF-8", TZ: "UTC"},
  {LANG: "tr_TR.UTF-8", TZ: "America/Los_Angeles"},
].map(env => {
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", executable], {cwd: root, env: {...process.env, ...env}, encoding: "utf8", timeout: 20_000});
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).success, true); return result.stdout;
});
assert.equal(outputs[0], outputs[1]);
console.log("Locale/timezone golden JSON: identical; all temporary control source restored.");
