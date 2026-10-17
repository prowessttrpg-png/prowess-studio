import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROWESS_DEFINITION_KINDS, buildRuntimeContexts, compileRuntime, createProwessDefinitionBundle, type ProwessDefinitionKind } from "@prowess/game";
import { createRulesetContext } from "@prowess/rules";

/**
 * M5-WO3 §104 / §216 — the WO3-generated M4 plans that the existing POST /api/rules/evaluate endpoint and Rules Inspector
 * are regression-tested with (apps/studio/tests/integration/m5-wo3-runtime-api.test.ts). This test REGENERATES them from
 * the canonical core + runtime content and the real compiler and requires the committed fixture to be identical, so the
 * API fixture can never drift from what @prowess/game compiles. Set M5_WO3_WRITE_FIXTURE=1 to rewrite it deliberately.
 *
 * The EXPLANATION / EXPLANATION_PROJECT steps are appended with existing M4 operations over the payment responses — AP
 * before / cost / AP after and ME / MP before / listed cost / payments / after come from M4's own payment trace, never
 * from browser arithmetic. Guards M5-I106 (exact Definition provenance on every runtime step) at the API boundary.
 */
const ROOT = path.resolve(import.meta.dirname, "../../../..");
const FIXTURE = path.join(ROOT, "apps/studio/tests/integration/fixtures/m5-wo3-runtime-plans.json");
const CONTENT_DIR = path.join(ROOT, "packages/prowess-game/src/content/core-playtest-v0.1");
type Definition = { canonicalKey: string; definitionKind: ProwessDefinitionKind; payload: Record<string, unknown> };
const load = (file: string) => (JSON.parse(readFileSync(path.join(CONTENT_DIR, file), "utf8")) as { definitions: Definition[] }).definitions;
const DEFINITIONS = [...load("core-resolution.json"), ...load("runtime-resources.json")];
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const RULESET = uuid(8501);
const MANIFEST = uuid(8502);

function bundle() {
  const identity = (i: number) => ({ entityId: uuid(8600 + i), entityVersionId: uuid(8800 + i) });
  const rules = DEFINITIONS.map((d, i) => ({ ...identity(i), canonicalKey: d.canonicalKey, entityType: PROWESS_DEFINITION_KINDS[d.definitionKind].entityTypes[0], sourceRulesetId: RULESET, sourceManifestId: MANIFEST }));
  const ruleset = createRulesetContext({ rulesetId: RULESET, manifestId: MANIFEST, rules });
  if (!ruleset.ok) throw new Error("ruleset");
  const definitions = DEFINITIONS.map((d, i) => ({
    schemaVersion: 1,
    systemFamily: PROWESS_DEFINITION_KINDS[d.definitionKind].family,
    definitionKind: d.definitionKind,
    ...identity(i),
    canonicalKey: d.canonicalKey,
    payload: d.payload,
    provenance: { rulesetId: RULESET, manifestId: MANIFEST, releaseId: null, sourceRulesetId: RULESET, sourceManifestId: MANIFEST, legacyTerms: [] },
  }));
  const out = createProwessDefinitionBundle({ ruleset: ruleset.value, definitions });
  if (!out.ok) throw new Error(JSON.stringify(out.problems));
  return { ruleset: ruleset.value, bundle: out.value };
}

function build() {
  const { ruleset, bundle: definitions } = bundle();
  const character = { level: 1, characterDie: { dieKey: "D4" }, stats: { STR: 3, AGI: 6, CON: 3, PER: 3, RES: 3, PRO: 5 }, baseHp: 10, baseMp: 15, skillRanks: [], explicitBonuses: [] };
  const compile = (subject: Record<string, unknown>, resources: unknown, combat?: unknown) => {
    const plan = compileRuntime({ contractVersion: 1, subject, definitions, ruleset, character, resources, ...(combat === undefined ? {} : { combat }) });
    if (!plan.ok) throw new Error(JSON.stringify(plan.problems));
    const ctx = buildRuntimeContexts({ definitions, character, resources, ...(combat === undefined ? {} : { combat }) });
    if (!ctx.ok) throw new Error(JSON.stringify(ctx.problems));
    return { plan: plan.value, actor: ctx.value.actor, runtime: ctx.value.runtime };
  };
  const explained = (stepKey: string, explanationKey: string) => ({
    explanation: { stepKey: "inspector.explanation", order: 1000000, operation: "EXPLANATION", input: { input: { explanationKey, contributions: [{ contributionKey: "payment", order: 1, kind: "RESOURCE", response: null }] } }, bindings: [{ target: "/input/contributions/0/response", source: { kind: "STEP", stepKey, pointer: "" } }] },
    summary: { stepKey: "inspector.summary", order: 1000010, operation: "EXPLANATION_PROJECT", input: { document: null, level: "SUMMARY" }, bindings: [{ target: "/document", source: { kind: "STEP", stepKey: "inspector.explanation", pointer: "/data" } }] },
  });

  // §104 / §106: AGI 6 → AP Capacity 5; current 5; Balanced Attack lists 2 AP → AP 3, explained by M4.
  const ap = compile({ kind: "ACTION_PAYMENT", subjectKey: "inspector", actionKey: "BALANCED_ATTACK", window: "OWN_TURN" }, { resources: [{ resourceKey: "AP", current: 5 }] });
  const apApply = ap.plan.outputs.payments[0]!.apply;
  const apSteps = explained(apApply, "action-points");
  // §104 / §111: listed 8 MP, ME 5, MP 18 → ME 5 + MP 3 → ME 0, MP 15; the listed cost stays 8.
  const mana = compile({ kind: "MAGICAL_PAYMENT", subjectKey: "inspector", costKey: "spell.test", listedAmount: 8, meEligible: true }, { resources: [{ resourceKey: "MP", current: 18 }, { resourceKey: "ME", current: 5 }] });
  const manaApply = mana.plan.outputs.payments[0]!.apply;
  const manaSteps = explained(manaApply, "mana-efficiency");
  // §125: start of Round 1, surprised — Counter Action refreshed to Capacity 1 but unavailable; ME refreshed to PRO 5.
  const round = compile({ kind: "RESOURCE_TIMING", subjectKey: "inspector", event: "START_OF_ROUND" }, { resources: [{ resourceKey: "ME", current: 1 }, { resourceKey: "COUNTER_ACTION", current: 0 }] }, { round: 1, surprised: true });

  return JSON.parse(
    JSON.stringify({
      note: "GENERATED by packages/prowess-db/tests/unit/m5-wo3-inspector-fixture.test.ts from the canonical core + runtime content and @prowess/game — do not edit by hand.",
      actionPoints: { evaluationKey: "m5-wo3.action-points", actor: ap.actor, runtime: ap.runtime, plan: { ...ap.plan.evaluationPlan, steps: [...ap.plan.evaluationPlan.steps, apSteps.explanation, apSteps.summary], explanationStepKey: "inspector.explanation" }, outputs: ap.plan.outputs, sourceMap: ap.plan.sourceMap },
      mana: { evaluationKey: "m5-wo3.mana", actor: mana.actor, runtime: mana.runtime, plan: { ...mana.plan.evaluationPlan, steps: [...mana.plan.evaluationPlan.steps, manaSteps.explanation, manaSteps.summary], explanationStepKey: "inspector.explanation" }, outputs: mana.plan.outputs, sourceMap: mana.plan.sourceMap },
      surpriseRound: { evaluationKey: "m5-wo3.surprise-round", actor: round.actor, runtime: round.runtime, plan: round.plan.evaluationPlan, outputs: round.plan.outputs, sourceMap: round.plan.sourceMap },
    }),
  ) as Record<string, unknown>;
}

describe("M5-WO3 Rules Inspector / API fixture is exactly what @prowess/game compiles", () => {
  it("regenerates identically (deterministic compilation of canonical content)", () => {
    const fresh = build();
    if (process.env.M5_WO3_WRITE_FIXTURE === "1") writeFileSync(FIXTURE, `${JSON.stringify(fresh, null, 2)}\n`);
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(fresh);
    expect(build()).toEqual(fresh);
  });
});
