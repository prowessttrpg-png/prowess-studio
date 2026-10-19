import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROWESS_DEFINITION_KINDS, compileAffinity, createProwessDefinitionBundle, type ProwessDefinitionKind } from "@prowess/game";
import { createRulesetContext } from "@prowess/rules";

/**
 * M5-WO4 §281 — the WO4-generated M4 Affinity plans that the existing POST /api/rules/evaluate endpoint and Rules
 * Inspector are regression-tested with (apps/studio/tests/integration/m5-wo4-affinity-api.test.ts). This test
 * REGENERATES them from the canonical Affinity content and the real compiler and requires the committed fixture to be
 * identical, so the API fixture can never drift from what @prowess/game compiles. Set M5_WO4_WRITE_FIXTURE=1 to rewrite
 * it deliberately.
 *
 * The neutral component Definitions below only state explicit Keywords (the Spell Effect catalog is a later Work Order).
 * The EXPLANATION / EXPLANATION_PROJECT steps are appended with existing M4 operations over the Affinity KEYWORD and
 * MODIFIER responses — base cost, Strength discount, after-Strength, Weakness penalty and after-Affinity values come
 * from M4's own modifier trace, never from browser arithmetic (§156).
 */
const ROOT = path.resolve(import.meta.dirname, "../../../..");
const FIXTURE = path.join(ROOT, "apps/studio/tests/integration/fixtures/m5-wo4-affinity-plans.json");
const CONTENT = JSON.parse(readFileSync(path.join(ROOT, "packages/prowess-game/src/content/core-playtest-v0.1/affinity.json"), "utf8")) as {
  definitions: { canonicalKey: string; definitionKind: ProwessDefinitionKind; schemaVersion: number; payload: Record<string, unknown> }[];
  keywords: { canonicalKey: string }[];
};
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const RULESET = uuid(9501);
const MANIFEST = uuid(9502);
const component = (canonicalKey: string, definitionKind: ProwessDefinitionKind, payload: Record<string, unknown>) => ({ canonicalKey, definitionKind, schemaVersion: 1, payload });
const DEFINITIONS = [
  ...CONTENT.definitions,
  component("spell.targeting.single", "SPELL_TARGETING", { semanticShape: "SINGLE_TARGET", geometry: { origin: "CASTER" } }),
  component("spell.effect.direct_damage", "SPELL_EFFECT", { effectFamily: "DAMAGE", resolution: null, outcomes: [], keywords: ["keyword.direct_damage"] }),
  component("spell.effect.healing", "SPELL_EFFECT", { effectFamily: "HEALING", resolution: null, outcomes: [], keywords: ["keyword.healing"] }),
  component("spell.duration.instant", "SPELL_DURATION", { durationConcept: "INSTANT" }),
];
const KEYWORDS = CONTENT.keywords.map((k, i) => ({ keywordId: uuid(9900 + i), canonicalKey: k.canonicalKey, categoryId: uuid(9899) }));

function bundle() {
  const identity = (i: number) => ({ entityId: uuid(9600 + i), entityVersionId: uuid(9700 + i) });
  const rules = DEFINITIONS.map((d, i) => ({ ...identity(i), canonicalKey: d.canonicalKey, entityType: PROWESS_DEFINITION_KINDS[d.definitionKind].entityTypes[0], sourceRulesetId: RULESET, sourceManifestId: MANIFEST }));
  const ruleset = createRulesetContext({ rulesetId: RULESET, manifestId: MANIFEST, rules });
  if (!ruleset.ok) throw new Error("ruleset");
  const definitions = DEFINITIONS.map((d, i) => ({
    schemaVersion: d.schemaVersion,
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
  const ref = (canonicalKey: string) => {
    const d = definitions.definitions.find((x) => x.canonicalKey === canonicalKey)!;
    return { entityId: d.entityId, entityVersionId: d.entityVersionId, canonicalKey: d.canonicalKey, definitionKind: d.definitionKind, systemFamily: d.systemFamily };
  };
  const profile = (rank: string) => ({ affinities: [{ affinity: ref("affinity.evocation"), rank, role: "PRIMARY", acquisition: null }] });
  const composition = {
    compositionKey: "composition.spell.inspector",
    abilityKind: "SPELL",
    affinity: { componentKey: "affinity", definition: ref("affinity.evocation"), parameters: {} },
    authority: null,
    keywords: [],
    targeting: { componentKey: "targeting", definition: ref("spell.targeting.single"), parameters: {} },
    effects: [
      { componentKey: "damage", order: 10, definition: ref("spell.effect.direct_damage"), parameters: {} },
      { componentKey: "healing", order: 20, definition: ref("spell.effect.healing"), parameters: {} },
    ],
    traits: [],
    duration: { componentKey: "duration", definition: ref("spell.duration.instant"), parameters: {} },
    conditions: [],
    branch: { kind: "SPELL", effectChain: null, sustain: null, concentration: null, data: {} },
  };
  const compile = (subject: Record<string, unknown>, rank: string) => {
    const plan = compileAffinity({ contractVersion: 1, subject, definitions, ruleset, profile: profile(rank), keywords: KEYWORDS });
    if (!plan.ok) throw new Error(JSON.stringify(plan.problems));
    return plan.value;
  };

  // §156 / M5-I155: base 20 · Evocation Expert · DIRECT_DAMAGE −20% + HEALING +30% → net 110% → 22, explained by M4.
  const cost = compile({ kind: "SPELL_AFFINITY_COST", subjectKey: "inspector", composition, costTarget: "LISTED_MP_COST", baseCost: 20 }, "EXPERT");
  const explanation = {
    stepKey: "inspector.explanation",
    order: 1000000,
    operation: "EXPLANATION",
    input: { input: { explanationKey: "affinity-cost", contributions: [{ contributionKey: "keywords", order: 1, kind: "KEYWORD", response: null }, { contributionKey: "affinity-net", order: 2, kind: "MODIFIER", response: null }, { contributionKey: "affinity", order: 3, kind: "MODIFIER", response: null }] } },
    bindings: [
      { target: "/input/contributions/0/response", source: { kind: "STEP", stepKey: cost.outputs.keywords!, pointer: "" } },
      { target: "/input/contributions/1/response", source: { kind: "STEP", stepKey: cost.outputs.cost!.netStepKey, pointer: "" } },
      { target: "/input/contributions/2/response", source: { kind: "STEP", stepKey: cost.outputs.cost!.stepKey, pointer: "" } },
    ],
  };
  const summary = { stepKey: "inspector.summary", order: 1000010, operation: "EXPLANATION_PROJECT", input: { document: null, level: "SUMMARY" }, bindings: [{ target: "/document", source: { kind: "STEP", stepKey: "inspector.explanation", pointer: "/data" } }] };
  // §195–§196: a Trait requires Evocation Expert; the character owns Evocation Trained → not satisfied.
  const access = compile({ kind: "AFFINITY_ACCESS", subjectKey: "inspector", requirements: [{ requirementKey: "TRAIT_ACCESS", affinity: ref("affinity.evocation"), minimumRank: "EXPERT", requiredKeywords: [] }] }, "TRAINED");

  return JSON.parse(
    JSON.stringify({
      note: "GENERATED by packages/prowess-db/tests/unit/m5-wo4-inspector-fixture.test.ts from the canonical Affinity content and @prowess/game — do not edit by hand.",
      cost: { evaluationKey: "m5-wo4.affinity-cost", plan: { ...cost.evaluationPlan, steps: [...cost.evaluationPlan.steps, explanation, summary], explanationStepKey: "inspector.explanation" }, outputs: cost.outputs, sourceMap: cost.sourceMap },
      access: { evaluationKey: "m5-wo4.affinity-access", plan: access.evaluationPlan, outputs: access.outputs, sourceMap: access.sourceMap },
    }),
  ) as Record<string, unknown>;
}

describe("M5-WO4 Rules Inspector / API fixture is exactly what @prowess/game compiles", () => {
  it("regenerates identically (deterministic compilation of canonical Affinity content)", () => {
    const fresh = build();
    if (process.env.M5_WO4_WRITE_FIXTURE === "1") writeFileSync(FIXTURE, `${JSON.stringify(fresh, null, 2)}\n`);
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(fresh);
    expect(build()).toEqual(fresh);
  });
});
