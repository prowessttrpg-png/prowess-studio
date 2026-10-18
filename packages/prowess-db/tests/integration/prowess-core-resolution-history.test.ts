/**
 * M5-WO2 core resolution against the REAL database — exact Release history and cross-Ruleset isolation (§99, §205–206).
 * Runs only against prowess_studio_test (guarded). The 30 canonical core Definitions come from
 * packages/prowess-game/src/content/core-playtest-v0.1/core-resolution.json and are stored as ordinary EntityVersions
 * (structuredData.prowessDefinition) — no schema change, no seeding singleton, no "current rules".
 *
 * Invariants guarded here (docs/architecture/m5-invariants.md): M5-I050 arithmetic and comparisons run in M4 for an
 * exact Release · M5-I074 derived character statistics calculate through M4 primitives and reproduce exactly per
 * Release; no Resource transition is compiled.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { CreateChangeSetOperationInput } from "@prowess/model";
import { PROWESS_DEFINITION_KINDS, PROWESS_DEFINITION_STORAGE_KEY, buildCoreResolutionContexts, compileCoreResolution, type ProwessDefinitionBundle } from "@prowess/game";
import { orchestrateRulesEvaluation, type RulesetContext } from "@prowess/rules";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  approveChangeSet,
  approveRuleset,
  createCanonPolicy,
  createChangeSet,
  createEntity,
  createEntityVersion,
  createRuleset,
  createRulesetManifest,
  materializeProwessDefinitionsFromRelease,
  prisma,
  publishRulesetRelease,
  submitChangeSetForReview,
  submitRulesetForReview,
  transitionEntityVersionStatus,
} from "../../src/index";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";

interface ContentDefinition {
  canonicalKey: string;
  definitionKind: string;
  payload: Record<string, unknown>;
}
const contentDoc = (file: string) => JSON.parse(readFileSync(path.resolve(import.meta.dirname, `../../../prowess-game/src/content/core-playtest-v0.1/${file}`), "utf8")) as { definitions: ContentDefinition[] };
// The core-resolution Definitions plus the CREATURE_SIZE Definitions: since the post-WO4 designer ruling on M5-SC-033,
// BASE_MOVEMENT reads the character's exact Size Definition (M5-I152), so a core Release pins the Sizes too.
const CONTENT = { definitions: [...contentDoc("core-resolution.json").definitions, ...contentDoc("runtime-resources.json").definitions.filter((d) => d.definitionKind === "CREATURE_SIZE")] };
const FAMILY: Record<string, string> = { STAT: "CHARACTER", DERIVED_STAT: "CHARACTER", CHARACTER_DIE_PROGRESSION: "CORE", CORE_RESOLUTION: "CORE", RANK_LADDER: "SKILL", SKILL_RANK: "SKILL", CREATURE_SIZE: PROWESS_DEFINITION_KINDS.CREATURE_SIZE.family };

const tag = `${Date.now()}`;
let counter = 0;
const next = () => ++counter;
const rulesetIds: string[] = [];
const entityIds: string[] = [];

const stored = (d: ContentDefinition, payload: Record<string, unknown> = d.payload) => ({
  [PROWESS_DEFINITION_STORAGE_KEY]: { schemaVersion: 1, systemFamily: FAMILY[d.definitionKind], definitionKind: d.definitionKind, payload },
});
async function version(entityId: string, name: string, structuredData: object) {
  const v = await createEntityVersion(entityId, { displayName: name, structuredData });
  await transitionEntityVersionStatus(v.id, "IN_REVIEW");
  return transitionEntityVersionStatus(v.id, "APPROVED");
}

/** R1: every canonical core Definition, v1, published as an exact Release. */
async function publishCoreR1(label: string) {
  const r = await createRuleset({ canonicalKey: `test.ruleset.m5core_${label}_${tag}_${next()}`, name: `M5 Core ${label}`, channel: "CORE_PLAYTEST", versionLabel: `m5 core ${label}` });
  rulesetIds.push(r.id);
  await submitRulesetForReview(r.id);
  await approveRuleset(r.id);
  const pins: { entityId: string; entityVersionId: string; key: string }[] = [];
  for (const d of CONTENT.definitions) {
    const e = await createEntity({ entityType: "GENERIC_RULE", canonicalKey: `test.m5core.${d.canonicalKey.replace(/\./g, "_")}_${tag}_${next()}` });
    entityIds.push(e.id);
    const v = await version(e.id, `${d.canonicalKey} v1`, stored(d));
    pins.push({ entityId: e.id, entityVersionId: v.id, key: d.canonicalKey });
  }
  const m = await createRulesetManifest(r.id, { entries: pins.map(({ entityId, entityVersionId }) => ({ entityId, entityVersionId })) });
  const policy = await createCanonPolicy(r.id, { name: `P ${next()}`, authorities: [] });
  const r1 = await publishRulesetRelease({ rulesetId: r.id, baseManifestId: m.id, canonPolicyId: policy.id, versionLabel: `${label} R1` });
  return { r, pins, policy, r1 };
}

const CHARACTER = {
  level: 5,
  characterDie: { dieKey: "D8" },
  stats: { STR: 6, AGI: 3, CON: 4, PER: 4, RES: 6, PRO: 6 },
  baseHp: 10,
  baseMp: 4,
  skillRanks: [],
  explicitBonuses: [{ bonusKey: "weapon", appliesTo: "ATTACK_ROLL", value: 1 }],
};

/** Compile (pure domain) → evaluate (frozen M4) for one exact materialized Release. */
function evaluateCore(materialized: { ruleset: RulesetContext; bundle: ProwessDefinitionBundle }) {
  const run = (subject: Record<string, unknown>, runtime: { roll?: unknown; targetDodge?: number } = {}) => {
    const plan = compileCoreResolution({ contractVersion: 1, subject, definitions: materialized.bundle, ruleset: materialized.ruleset, character: CHARACTER });
    if (!plan.ok) throw new Error(JSON.stringify(plan.problems));
    const ctx = buildCoreResolutionContexts({ definitions: materialized.bundle, character: CHARACTER, plan: plan.value, ...runtime });
    if (!ctx.ok) throw new Error(JSON.stringify(ctx.problems));
    const response = orchestrateRulesEvaluation({ evaluationKey: "m5-wo2.history", contexts: { ruleset: materialized.ruleset, actor: ctx.value.actor, runtime: ctx.value.runtime }, plan: plan.value.evaluationPlan });
    if (!response.success || response.data === null) throw new Error(JSON.stringify(response.errors));
    const values = Object.fromEntries(response.data.steps.map((s) => [s.stepKey, (s.response?.data as { finalValue?: number; satisfied?: boolean } | null)?.finalValue ?? (s.response?.data as { satisfied?: boolean } | null)?.satisfied ?? null]));
    return { plan: plan.value, run: response.data, values };
  };
  const sheet = run({ kind: "DERIVED_STATISTICS", subjectKey: "sheet" });
  const attack = run({ kind: "CORE_RESOLUTION", subjectKey: "strike", procedure: "ATTACK_ROLL", mode: "NORMAL" }, { roll: { die: { dieKey: "D8", faces: 8 }, mode: "NORMAL", rolls: [5] }, targetDodge: 11 });
  const d = (s: string) => sheet.values[`prowess:DERIVED_STATISTICS:sheet:derived.${s}`];
  return {
    sheet,
    attack,
    summary: {
      dodge: d("DODGE"),
      characterDc: d("CHARACTER_DC"),
      maximumHp: d("MAXIMUM_HP"),
      maximumMp: d("MAXIMUM_MP"),
      accuracy: d("ACCURACY"),
      counterActionCapacity: d("COUNTER_ACTION_CAPACITY"),
      attackTotal: attack.values["prowess:CORE_RESOLUTION:strike:total"],
      attackHits: attack.values["prowess:CORE_RESOLUTION:strike:success"],
    },
  };
}

describe("M5-WO2 core resolution — exact Release history and isolation (prowess_studio_test only)", () => {
  beforeAll(() => {
    assertRunningAgainstTestDatabase(getTestDatabaseUrl());
  });

  afterAll(async () => {
    await prisma.rulesetRelease.deleteMany({ where: { rulesetId: { in: rulesetIds } } });
    await prisma.changeSetOperation.deleteMany({ where: { rulesetId: { in: rulesetIds } } });
    await prisma.changeSet.deleteMany({ where: { rulesetId: { in: rulesetIds } } });
    await prisma.sourceAuthorityRecord.deleteMany({ where: { canonPolicy: { rulesetId: { in: rulesetIds } } } });
    await prisma.canonPolicy.deleteMany({ where: { rulesetId: { in: rulesetIds } } });
    await prisma.rulesetManifestEntry.deleteMany({ where: { manifest: { rulesetId: { in: rulesetIds } } } });
    await prisma.rulesetManifest.updateMany({ where: { rulesetId: { in: rulesetIds } }, data: { parentManifestId: null } });
    await prisma.rulesetManifest.deleteMany({ where: { rulesetId: { in: rulesetIds } } });
    await prisma.ruleset.deleteMany({ where: { id: { in: rulesetIds } } });
    await prisma.entityVersion.updateMany({ where: { entityId: { in: entityIds } }, data: { parentVersionId: null } });
    await prisma.entityVersion.deleteMany({ where: { entityId: { in: entityIds } } });
    await prisma.entity.deleteMany({ where: { id: { in: entityIds } } });
  });

  it("§205 R1 evaluates the canonical core; after R2 changes Definition values, R1 re-evaluates identically", async () => {
    const g = await publishCoreR1("history");
    const first = await materializeProwessDefinitionsFromRelease(g.r1.id);
    expect(first.bundle.definitions).toHaveLength(CONTENT.definitions.length);
    const r1 = evaluateCore(first);
    // Golden values (§126–§129) for this character under R1.
    expect(r1.summary).toEqual({ dodge: 8, characterDc: 12, maximumHp: 14, maximumMp: 10, accuracy: 2, counterActionCapacity: 1, attackTotal: 12, attackHits: true });
    expect(new Set(r1.sheet.plan.evaluationPlan.steps.map((s) => s.operation))).toEqual(new Set(["FORMULA"]));
    expect(r1.sheet.plan.rulesetProvenance.release).toEqual({ releaseId: g.r1.id, releaseNumber: 1, versionLabel: "history R1" });

    // R2: test-only revised values for Accuracy and Counter Action capacity (new EntityVersions via a ChangeSet).
    const revise: Record<string, Record<string, unknown>> = {
      "core.derived.accuracy": { ...CONTENT.definitions.find((d) => d.canonicalKey === "core.derived.accuracy")!.payload, formula: { expression: "floor(pro / 2)", rounding: "NONE", variables: [{ variable: "pro", source: { kind: "STAT", stat: "PRO" } }] } },
      "core.derived.counter_action_capacity": { ...CONTENT.definitions.find((d) => d.canonicalKey === "core.derived.counter_action_capacity")!.payload, formula: { expression: "2", rounding: "NONE", variables: [] } },
    };
    const operations: CreateChangeSetOperationInput[] = [];
    for (const [key, payload] of Object.entries(revise)) {
      const pin = g.pins.find((p) => p.key === key)!;
      const def = CONTENT.definitions.find((d) => d.canonicalKey === key)!;
      const v2 = await version(pin.entityId, `${key} v2`, stored(def, payload));
      operations.push({ operationType: "REPLACE_ENTITY_VERSION", targetEntityId: pin.entityId, fromEntityVersionId: pin.entityVersionId, toEntityVersionId: v2.id });
    }
    const cs = await createChangeSet(g.r.id, { name: `cs ${next()}`, operations });
    await submitChangeSetForReview(cs.id);
    await approveChangeSet(cs.id);
    const release2 = await publishRulesetRelease({ rulesetId: g.r.id, baseManifestId: g.r1.manifestId, canonPolicyId: g.policy.id, changeSetId: cs.id, versionLabel: "history R2" });

    const second = await materializeProwessDefinitionsFromRelease(release2.id);
    const r2 = evaluateCore(second);
    expect(r2.summary).toEqual({ ...r1.summary, accuracy: 3, counterActionCapacity: 2, attackTotal: 13 });

    const again = await materializeProwessDefinitionsFromRelease(g.r1.id);
    expect(again).toEqual(first);
    const r1Again = evaluateCore(again);
    expect(r1Again.summary).toEqual(r1.summary);
    expect(r1Again.attack.plan).toEqual(r1.attack.plan);
    expect(r1Again.attack.run).toEqual(r1.attack.run);
  });

  it("§206 R1 and R2 evaluate concurrently without cross-contamination; a bundle never runs under another Release", async () => {
    const g = await publishCoreR1("isolation");
    const pin = g.pins.find((p) => p.key === "core.derived.counter_action_capacity")!;
    const def = CONTENT.definitions.find((d) => d.canonicalKey === "core.derived.counter_action_capacity")!;
    const v2 = await version(pin.entityId, "counter v2", stored(def, { ...def.payload, formula: { expression: "3", rounding: "NONE", variables: [] } }));
    const cs = await createChangeSet(g.r.id, { name: `cs ${next()}`, operations: [{ operationType: "REPLACE_ENTITY_VERSION", targetEntityId: pin.entityId, fromEntityVersionId: pin.entityVersionId, toEntityVersionId: v2.id }] });
    await submitChangeSetForReview(cs.id);
    await approveChangeSet(cs.id);
    const release2 = await publishRulesetRelease({ rulesetId: g.r.id, baseManifestId: g.r1.manifestId, canonPolicyId: g.policy.id, changeSetId: cs.id, versionLabel: "isolation R2" });

    const [a, b] = await Promise.all([materializeProwessDefinitionsFromRelease(g.r1.id), materializeProwessDefinitionsFromRelease(release2.id)]);
    const [ra, rb] = [evaluateCore(a), evaluateCore(b)];
    expect([ra.summary.counterActionCapacity, rb.summary.counterActionCapacity]).toEqual([1, 3]);
    const cited = (x: typeof ra) => new Set<string>(x.sheet.plan.sourceMap.entries.flatMap((e) => e.definitions.map((d) => d.entityVersionId)));
    expect(cited(ra).has(pin.entityVersionId) && !cited(ra).has(v2.id)).toBe(true);
    expect(cited(rb).has(v2.id) && !cited(rb).has(pin.entityVersionId)).toBe(true);

    // Mixing: R1's bundle under R2's exact context fails closed.
    const mixed = compileCoreResolution({ contractVersion: 1, subject: { kind: "DERIVED_STATISTICS", subjectKey: "s" }, definitions: a.bundle, ruleset: b.ruleset, character: CHARACTER });
    expect(mixed.ok).toBe(false);
  });
});
