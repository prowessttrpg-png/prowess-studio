/**
 * M4-WO4: exact M1 Keyword data maps into @prowess/rules Keyword contributions (PAS-10 M4-WO4 §84).
 * Runs only against prowess_studio_test (guarded). Uses existing M1 services only — no new DB service exists.
 *
 * Guards M4-I41 (Keyword Identity Is Exact), M4-I43 (Duplicate Contributions Preserve Provenance) and M4-I47 (Keyword
 * Resolution Is Read-Only) against real persisted M1 data.
 */
import { resolveKeywords, findResolvedKeywordByCanonicalKey, type ResolvedKeywordSet } from "@prowess/rules";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assignKeywordToEntity,
  assignKeywordToEntityVersion,
  createEntity,
  createEntityAlias,
  createEntityVersion,
  createKeywordCategory,
  createKeywordDefinition,
  listEntityKeywords,
  listEntityVersionKeywords,
  prisma,
} from "../../src/index";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";

const tag = `${Date.now()}`;
const entityIds: string[] = [];
const keywordIds: string[] = [];
const categoryIds: string[] = [];

/** The application-layer mapping a future service would perform: an M1 KeywordDefinition → an exact reference. */
const reference = (k: { id: string; canonicalKey: string; categoryId: string | null }) => ({ keywordId: k.id, canonicalKey: k.canonicalKey, categoryId: k.categoryId });

async function fingerprint(): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<{ h: string }>>(
    `SELECT md5(string_agg(t, '|' ORDER BY t)) AS h FROM (
       SELECT 'd' || x::text AS t FROM keyword_definitions x UNION ALL
       SELECT 'c' || x::text FROM keyword_categories x UNION ALL
       SELECT 'e' || x::text FROM entity_keywords x UNION ALL
       SELECT 'v' || x::text FROM entity_version_keywords x
     ) s`,
  );
  return rows[0]?.h ?? "";
}

describe("M1 Keyword data → M4-WO4 resolution (prowess_studio_test only)", () => {
  beforeAll(() => {
    assertRunningAgainstTestDatabase(getTestDatabaseUrl());
  });

  afterAll(async () => {
    await prisma.entityVersionKeyword.deleteMany({ where: { keywordId: { in: keywordIds } } });
    await prisma.entityKeyword.deleteMany({ where: { keywordId: { in: keywordIds } } });
    await prisma.keywordDefinition.deleteMany({ where: { id: { in: keywordIds } } });
    await prisma.keywordCategory.deleteMany({ where: { id: { in: categoryIds } } });
    await prisma.entityAlias.deleteMany({ where: { entityId: { in: entityIds } } });
    await prisma.entityVersion.deleteMany({ where: { entityId: { in: entityIds } } });
    await prisma.entity.deleteMany({ where: { id: { in: entityIds } } });
  });

  it("assignments read through existing M1 services resolve exactly, keep every contributor, and change nothing", async () => {
    const category = await createKeywordCategory({ canonicalKey: `keyword.category.ctx_${tag}`, name: "Context Category" });
    categoryIds.push(category.id);
    const fire = await createKeywordDefinition({ canonicalKey: `keyword.ctx_fire_${tag}`, name: "Fire", categoryId: category.id });
    const zone = await createKeywordDefinition({ canonicalKey: `keyword.ctx_zone_${tag}`, name: "Zone" });
    keywordIds.push(fire.id, zone.id);

    const effect = await createEntity({ entityType: "GENERIC_RULE", canonicalKey: `test.kw.effect_${tag}` });
    const trait = await createEntity({ entityType: "GENERIC_RULE", canonicalKey: `test.kw.trait_${tag}` });
    entityIds.push(effect.id, trait.id);
    const effectV1 = await createEntityVersion(effect.id, { displayName: "Effect V1" });
    await createEntityAlias(effect.id, { alias: "Burning Thing" });
    await assignKeywordToEntityVersion(effectV1.id, fire.id);
    await assignKeywordToEntityVersion(effectV1.id, zone.id);
    await assignKeywordToEntity(trait.id, fire.id);

    const before = await fingerprint();
    const fromVersion = (await listEntityVersionKeywords(effectV1.id)).map((a) => ({
      keyword: reference(a.keyword),
      source: { sourceType: "entity_version", sourceKey: effectV1.id, sourceId: effectV1.id, provenance: { entityId: effect.id, entityVersionId: effectV1.id, canonicalKey: effect.canonicalKey, rulesetId: null, manifestId: null } },
    }));
    const fromEntity = (await listEntityKeywords(trait.id)).map((a) => ({
      keyword: reference(a.keyword),
      source: { sourceType: "entity", sourceKey: trait.id, sourceId: trait.id, provenance: { entityId: trait.id, entityVersionId: null, canonicalKey: trait.canonicalKey, rulesetId: null, manifestId: null } },
    }));

    const response = resolveKeywords([...fromEntity, ...fromVersion]);
    expect(response.status).toBe("SUCCESS");
    const set = response.data as ResolvedKeywordSet;
    expect(set.keywords.map((k) => k.keyword)).toEqual(
      [reference(fire), reference(zone)].sort((a, b) => (a.canonicalKey < b.canonicalKey ? -1 : 1)),
    );
    expect(findResolvedKeywordByCanonicalKey(set, fire.canonicalKey)?.contributors.map((c) => [c.source.sourceType, c.source.provenance?.entityId])).toEqual([
      ["entity", trait.id],
      ["entity_version", effect.id],
    ]);
    // The display name ("Fire") and the Entity alias are never part of identity or lookup.
    expect(findResolvedKeywordByCanonicalKey(set, "Fire")).toBeNull();
    expect(findResolvedKeywordByCanonicalKey(set, "Burning Thing")).toBeNull();
    // Same exact data, reversed order → identical result; nothing persisted changed.
    expect(JSON.stringify(resolveKeywords([...fromVersion, ...fromEntity]).data)).toBe(JSON.stringify(set));
    expect(await fingerprint()).toBe(before);
  });
});
