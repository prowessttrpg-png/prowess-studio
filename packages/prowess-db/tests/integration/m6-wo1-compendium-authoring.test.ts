/**
 * PAS-10 M6-WO1 — Compendium authoring service: database integration (§71–74). Runs only against prowess_studio_test.
 *
 *  - M5 BRIDGE ACROSS KINDS (§72): every reference-free Ability-component Definition of the certified M5 fixtures is
 *    authored through the authoring service exactly as a designer would, approved through M1, pinned by an M2
 *    Manifest and materialized through the EXISTING server path — the materialized payload equals the M5 fixture's.
 *    This proves authoring → actual Rules Engine content, not merely JSON in a database.
 *  - Concurrency (§46): two editors saving the same loaded Draft — exactly one wins, nothing is overwritten silently.
 *  - Revision allocation (§18): concurrent "Create New Revision" calls get distinct, server-allocated numbers.
 *
 * Fixture content is test-only (`test.m6wo1db.*`) and never game canon. Invariants: M6-I001, M6-I003, M6-I004, M6-I008.
 */
import { COMPENDIUM_AUTHORING_ERROR_CODES, DomainError } from "@prowess/model";
import { PROWESS_DEFINITION_KINDS, type ProwessDefinitionEnvelope } from "@prowess/game";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  approveRuleset,
  createAuthoredDefinition,
  createAuthoredRevision,
  createKeywordDefinition,
  createRuleset,
  createRulesetManifest,
  findKeywordDefinitionByCanonicalKey,
  getEntityVersion,
  materializeProwessDefinitionsFromManifest,
  prisma,
  updateAuthoredDraftDefinition,
  submitRulesetForReview,
  transitionEntityVersionStatus,
  validateAuthoringCandidate,
} from "../../src/index";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";
import { abilityDefinitionFixture } from "../../../prowess-game/src/testing/ability-definition-fixtures.js";
import { durationConditionFixture } from "../../../prowess-game/src/testing/duration-condition-fixtures.js";

const tag = `${Date.now()}`;
let counter = 0;
const createdKeywordIds: string[] = [];
const rulesetIds: string[] = [];
const PREFIX = "test.m6wo1db";

// The authored-ability fixture plus the M5-WO9 Duration / Ability Condition fixture (Casting / Maneuver Conditions).
const DEFINITIONS = [...abilityDefinitionFixture().bundle.definitions, ...durationConditionFixture().bundle.definitions].filter(
  (d, i, all) => all.findIndex((x) => x.canonicalKey === d.canonicalKey) === i,
);
const REF_KEYS = "canonicalKey,definitionKind,entityId,entityVersionId,systemFamily";
const hasExactRef = (v: unknown): boolean =>
  Array.isArray(v) ? v.some(hasExactRef) : v !== null && typeof v === "object" ? Object.keys(v).sort().join(",") === REF_KEYS || Object.values(v).some(hasExactRef) : false;
/** Reference-free Ability-component Definitions (Targeting / Effect / Trait / Duration / Condition / Foundation). */
const COMPONENTS = DEFINITIONS.filter((d) => PROWESS_DEFINITION_KINDS[d.definitionKind].contract !== null && !hasExactRef(d.payload));
const storedContent = (d: ProwessDefinitionEnvelope) => ({ schemaVersion: d.schemaVersion, systemFamily: d.systemFamily, definitionKind: d.definitionKind, payload: JSON.parse(JSON.stringify(d.payload)) as unknown });
const keyFor = (label: string) => `${PREFIX}.${label.replace(/[^a-z0-9_]/g, "_")}_${tag}_${++counter}`;

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
}

describe("M6-WO1 Compendium authoring service (prowess_studio_test only)", () => {
  beforeAll(async () => {
    assertRunningAgainstTestDatabase(getTestDatabaseUrl());
    // The payload Keywords the fixture Definitions cite must exist in the Keyword vocabulary (§22).
    const keys = [...new Set(COMPONENTS.flatMap((d) => ((d.payload as { keywords?: string[] }).keywords ?? [])))];
    for (const canonicalKey of keys) {
      if ((await findKeywordDefinitionByCanonicalKey(canonicalKey)) !== null) continue;
      createdKeywordIds.push((await createKeywordDefinition({ canonicalKey, name: `${canonicalKey} (M6-WO1 test)` })).id);
    }
  });

  afterAll(async () => {
    await prisma.rulesetManifestEntry.deleteMany({ where: { manifest: { rulesetId: { in: rulesetIds } } } });
    await prisma.rulesetManifest.deleteMany({ where: { rulesetId: { in: rulesetIds } } });
    await prisma.ruleset.deleteMany({ where: { id: { in: rulesetIds } } });
    const entityIds = (await prisma.entity.findMany({ where: { canonicalKey: { startsWith: PREFIX } }, select: { id: true } })).map((e: { id: string }) => e.id);
    const versionIds = (await prisma.entityVersion.findMany({ where: { entityId: { in: entityIds } }, select: { id: true } })).map((v: { id: string }) => v.id);
    await prisma.entityVersionKeyword.deleteMany({ where: { entityVersionId: { in: versionIds } } });
    await prisma.entityVersion.updateMany({ where: { id: { in: versionIds } }, data: { parentVersionId: null } });
    await prisma.entityVersion.deleteMany({ where: { id: { in: versionIds } } });
    await prisma.entity.deleteMany({ where: { id: { in: entityIds } } });
    await prisma.keywordDefinition.deleteMany({ where: { id: { in: createdKeywordIds } } });
  });

  it("covers every Ability-component contract with real certified fixture content", () => {
    const contracts = new Set(COMPONENTS.map((d) => PROWESS_DEFINITION_KINDS[d.definitionKind].contract));
    for (const c of ["TARGETING", "EFFECT", "TRAIT", "DURATION", "ABILITY_CONDITION"]) expect(contracts, c).toContain(c);
    expect(COMPONENTS.length).toBeGreaterThan(15);
  });

  it("M6-I003 authoring validation accepts every certified fixture component with no M5 or reference issue", async () => {
    for (const d of COMPONENTS) {
      const result = await validateAuthoringCandidate({ definitionKind: d.definitionKind, prowessDefinition: storedContent(d) });
      expect([result.status, result.issues], d.canonicalKey).toEqual(["PASS", []]);
      expect(result.normalized?.payload, d.canonicalKey).toEqual(d.payload);
    }
  });

  it("§72 M5 BRIDGE across kinds: authored → approved → pinned → materialized content equals the certified Definitions", async () => {
    const authored: Array<{ fixture: ProwessDefinitionEnvelope; entityId: string; versionId: string }> = [];
    for (const d of COMPONENTS) {
      const r = await createAuthoredDefinition({ definitionKind: d.definitionKind, canonicalKey: keyFor(d.canonicalKey), displayName: `${d.canonicalKey} (test)`, prowessDefinition: storedContent(d) });
      expect([r.version.status, r.version.revisionNumber, r.entity.entityType]).toEqual(["DRAFT", 1, PROWESS_DEFINITION_KINDS[d.definitionKind].entityTypes[0]]);
      await transitionEntityVersionStatus(r.version.id, "IN_REVIEW");
      await transitionEntityVersionStatus(r.version.id, "APPROVED");
      authored.push({ fixture: d, entityId: r.entity.id, versionId: r.version.id });
    }
    const ruleset = await createRuleset({ canonicalKey: keyFor("bridge"), name: "M6-WO1 bridge (test)", channel: "CORE_PLAYTEST", versionLabel: "m6 bridge" });
    rulesetIds.push(ruleset.id);
    await submitRulesetForReview(ruleset.id);
    await approveRuleset(ruleset.id);
    const manifest = await createRulesetManifest(ruleset.id, { entries: authored.map((a) => ({ entityId: a.entityId, entityVersionId: a.versionId })) });
    const { bundle } = await materializeProwessDefinitionsFromManifest(manifest.id);
    expect(bundle.definitions).toHaveLength(authored.length);
    for (const a of authored) {
      const m = bundle.definitions.find((x) => x.entityVersionId === a.versionId)!;
      expect({ kind: m.definitionKind, family: m.systemFamily, payload: m.payload }, a.fixture.canonicalKey).toEqual({ kind: a.fixture.definitionKind, family: a.fixture.systemFamily, payload: a.fixture.payload });
    }
  });

  it("§46 two editors save the same loaded Draft: exactly one wins, the other is STALE and nothing is overwritten", async () => {
    const d = COMPONENTS[0]!;
    const { version } = await createAuthoredDefinition({ definitionKind: d.definitionKind, canonicalKey: keyFor("concurrent"), displayName: "Loaded", prowessDefinition: storedContent(d) });
    const loaded = version.updatedAt.toISOString();
    const first = await updateAuthoredDraftDefinition(version.id, { expectedUpdatedAt: loaded, displayName: "Editor A" });
    expect(first.version.displayName).toBe("Editor A");
    await expectCode(updateAuthoredDraftDefinition(version.id, { expectedUpdatedAt: loaded, displayName: "Editor B" }), COMPENDIUM_AUTHORING_ERROR_CODES.STALE_REVISION);
    expect((await getEntityVersion(version.id)).displayName).toBe("Editor A");
  });

  it("§18 concurrent Create New Revision calls get distinct server-allocated revision numbers; the base is untouched", async () => {
    const d = COMPONENTS[1]!;
    const { entity, version } = await createAuthoredDefinition({ definitionKind: d.definitionKind, canonicalKey: keyFor("revisions"), displayName: "Base", prowessDefinition: storedContent(d) });
    const before = JSON.stringify(await prisma.entityVersion.findUnique({ where: { id: version.id } }));
    const made = await Promise.all([1, 2, 3].map(() => createAuthoredRevision(entity.id, { baseVersionId: version.id })));
    expect(made.map((v) => v.revisionNumber).sort()).toEqual([2, 3, 4]);
    for (const v of made) expect([v.status, v.parentVersionId, v.structuredData]).toEqual(["DRAFT", version.id, version.structuredData]);
    expect(JSON.stringify(await prisma.entityVersion.findUnique({ where: { id: version.id } }))).toBe(before);
  });
});
