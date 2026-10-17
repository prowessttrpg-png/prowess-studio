import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROWESS_DEFINITION_KINDS, buildCoreResolutionContexts, compileCoreResolution, createProwessDefinitionBundle, type ProwessDefinitionKind } from "@prowess/game";
import { createRulesetContext } from "@prowess/rules";

/**
 * M5-WO2 §107 / §109 / §210 — the WO2-generated M4 plans that the existing POST /api/rules/evaluate endpoint and Rules
 * Inspector are regression-tested with (apps/studio/tests/integration/m5-wo2-core-api.test.ts). This test REGENERATES
 * them from the canonical core content and the real compiler and requires the committed fixture to be identical, so the
 * API fixture can never drift from what @prowess/game compiles. Set M5_WO2_WRITE_FIXTURE=1 to rewrite it deliberately.
 *
 * The EXPLANATION / EXPLANATION_PROJECT steps are appended here with existing M4 operations: there is no separate
 * Prowess explanation engine. Guards M5-I050 (arithmetic in M4) at the API boundary.
 */
const ROOT = path.resolve(import.meta.dirname, "../../../..");
const FIXTURE = path.join(ROOT, "apps/studio/tests/integration/fixtures/m5-wo2-core-plans.json");
const CONTENT = JSON.parse(readFileSync(path.join(ROOT, "packages/prowess-game/src/content/core-playtest-v0.1/core-resolution.json"), "utf8")) as {
  definitions: Array<{ canonicalKey: string; definitionKind: ProwessDefinitionKind; payload: Record<string, unknown> }>;
};
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const RULESET = uuid(8001);
const MANIFEST = uuid(8002);

function bundle() {
  const rules = CONTENT.definitions.map((d, i) => ({ entityId: uuid(8100 + i), entityVersionId: uuid(8300 + i), canonicalKey: d.canonicalKey, entityType: "GENERIC_RULE", sourceRulesetId: RULESET, sourceManifestId: MANIFEST }));
  const ruleset = createRulesetContext({ rulesetId: RULESET, manifestId: MANIFEST, rules });
  if (!ruleset.ok) throw new Error("ruleset");
  const definitions = CONTENT.definitions.map((d, i) => ({
    schemaVersion: 1,
    systemFamily: PROWESS_DEFINITION_KINDS[d.definitionKind].family,
    definitionKind: d.definitionKind,
    entityId: uuid(8100 + i),
    entityVersionId: uuid(8300 + i),
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
  const compile = (subject: Record<string, unknown>, character: Record<string, unknown>, runtime: Record<string, unknown> = {}) => {
    const plan = compileCoreResolution({ contractVersion: 1, subject, definitions, ruleset, character });
    if (!plan.ok) throw new Error(JSON.stringify(plan.problems));
    const ctx = buildCoreResolutionContexts({ definitions, character, plan: plan.value, ...runtime });
    if (!ctx.ok) throw new Error(JSON.stringify(ctx.problems));
    return { plan: plan.value, actor: ctx.value.actor, runtime: ctx.value.runtime };
  };

  // §109: Half d8 4 + Prowess 5 + Resolve +2 + other +1 = Character DC 12, explained through M4 EXPLANATION.
  const dc = compile(
    { kind: "DERIVED_STATISTICS", subjectKey: "inspector", statistics: ["CHARACTER_DC"] },
    { level: 5, characterDie: { dieKey: "D8" }, stats: { STR: 3, AGI: 3, CON: 3, PER: 3, RES: 6, PRO: 5 }, baseHp: 8, baseMp: 6, skillRanks: [], explicitBonuses: [{ bonusKey: "focus", appliesTo: "CHARACTER_DC", value: 1 }] },
  );
  const parts = ["bonuses.CHARACTER_DC", "derived.HALF_CHARACTER_DIE", "derived.CHARACTER_DC_RESOLVE_BONUS", "derived.CHARACTER_DC"].map((f) => `prowess:DERIVED_STATISTICS:inspector:${f}`);
  const explanation = {
    stepKey: "inspector.explanation",
    order: 2000,
    operation: "EXPLANATION",
    input: { input: { explanationKey: "character-dc", contributions: parts.map((stepKey, i) => ({ contributionKey: stepKey.split(":").pop(), order: i + 1, kind: "FORMULA", response: null })) } },
    bindings: parts.map((stepKey, i) => ({ target: `/input/contributions/${i}/response`, source: { kind: "STEP", stepKey, pointer: "" } })),
  };
  const summary = { stepKey: "inspector.summary", order: 2010, operation: "EXPLANATION_PROJECT", input: { document: null, level: "SUMMARY" }, bindings: [{ target: "/document", source: { kind: "STEP", stepKey: "inspector.explanation", pointer: "/data" } }] };

  // §129 / §131: d8 Advantage [3, 5] → natural 5 + PER 4 + Accuracy 2 + weapon 1 = 12 against Dodge 11.
  const attack = compile(
    { kind: "CORE_RESOLUTION", subjectKey: "inspector", procedure: "ATTACK_ROLL", mode: "ADVANTAGE" },
    { level: 5, characterDie: { dieKey: "D8" }, stats: { STR: 3, AGI: 3, CON: 3, PER: 4, RES: 3, PRO: 6 }, baseHp: 8, baseMp: 6, skillRanks: [], explicitBonuses: [{ bonusKey: "weapon", appliesTo: "ATTACK_ROLL", value: 1, category: "EQUIPMENT" }] },
    { roll: { die: { dieKey: "D8", faces: 8 }, mode: "ADVANTAGE", rolls: [3, 5] }, targetDodge: 11 },
  );

  return JSON.parse(
    JSON.stringify({
      note: "GENERATED by packages/prowess-db/tests/unit/m5-wo2-inspector-fixture.test.ts from the canonical core content and @prowess/game — do not edit by hand.",
      characterDc: { evaluationKey: "m5-wo2.character-dc", actor: dc.actor, runtime: dc.runtime, plan: { ...dc.plan.evaluationPlan, steps: [...dc.plan.evaluationPlan.steps, explanation, summary], explanationStepKey: "inspector.explanation" }, sourceMap: dc.plan.sourceMap },
      attack: { evaluationKey: "m5-wo2.attack", actor: attack.actor, runtime: attack.runtime, plan: attack.plan.evaluationPlan, outputs: attack.plan.outputs, sourceMap: attack.plan.sourceMap },
    }),
  ) as Record<string, unknown>;
}

describe("M5-WO2 Rules Inspector / API fixture is exactly what @prowess/game compiles", () => {
  it("regenerates identically (deterministic compilation of canonical content)", () => {
    const fresh = build();
    if (process.env.M5_WO2_WRITE_FIXTURE === "1") writeFileSync(FIXTURE, `${JSON.stringify(fresh, null, 2)}\n`);
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(fresh);
    expect(build()).toEqual(fresh);
  });
});
