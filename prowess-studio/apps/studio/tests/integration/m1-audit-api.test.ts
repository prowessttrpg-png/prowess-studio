/**
 * M1 audit gate — the canonical reproducibility scenario, driven through the
 * HTTP route handlers only (PAS-10 M1-WO11 §2–12, §18–20, §25). Prisma is
 * touched only for fixture cleanup and the one test that reads the database
 * to prove no mutation.
 *
 * The fixture is built once; each test then asserts one named invariant.
 * ORDER MATTERS in one place: "draft independence" EDITS Revision 2 and is
 * therefore last, after every assertion that expects Revision 2's original
 * authored values.
 *
 * Canonical keys use underscores (`historical_rule`): hyphens are not valid
 * canonical-key syntax.
 */
import { assertRunningAgainstTestDatabase, prisma } from "@prowess/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getEntity } from "../../app/api/entities/[entityId]/route";
import { GET as getAliases, POST as postAlias } from "../../app/api/entities/[entityId]/aliases/route";
import { GET as getEntityKeywords, POST as postEntityKeyword } from "../../app/api/entities/[entityId]/keywords/route";
import { GET as getRelationships } from "../../app/api/entities/[entityId]/relationships/route";
import { GET as getVersions, POST as postVersion } from "../../app/api/entities/[entityId]/versions/route";
import { GET as listEntities, POST as postEntity } from "../../app/api/entities/route";
import { GET as searchAliases } from "../../app/api/entity-aliases/search/route";
import { DELETE as deleteVersionKeyword } from "../../app/api/entity-versions/[versionId]/keywords/[keywordId]/route";
import {
  GET as getVersionKeywords,
  POST as postVersionKeyword,
} from "../../app/api/entity-versions/[versionId]/keywords/route";
import {
  GET as getVersionSources,
  POST as postVersionSource,
} from "../../app/api/entity-versions/[versionId]/sources/route";
import { GET as getVersion, PATCH as patchVersion } from "../../app/api/entity-versions/[versionId]/route";
import { POST as postStatus } from "../../app/api/entity-versions/[versionId]/status/route";
import { POST as postKeyword } from "../../app/api/keywords/route";
import { POST as postRelationship } from "../../app/api/relationships/route";
import { POST as postSourceDocument } from "../../app/api/source-documents/route";
import { getRequest, jsonRequest, routeParams } from "./helpers";

interface Entity { id: string; entityType: string; canonicalKey: string; createdAt: string; updatedAt: string }
interface Version {
  id: string; entityId: string; revisionNumber: number; status: string; displayName: string;
  rulesText: string | null; structuredData: Record<string, unknown>; parentVersionId: string | null; updatedAt: string;
}
interface Assignment { keyword: { id: string; name: string } }
interface Reference { id: string; sourceDocumentId: string; entityVersionId: string }
interface Doc { id: string; title: string; authorityStatus: string | null }
interface Named { id: string }

const BASE = "http://localhost";
const tag = `${Date.now()}`;
let n = 0;
const created = { entities: [] as string[], keywords: [] as string[], documents: [] as string[] };

async function ok<T>(res: Response, status = 200): Promise<T> {
  expect(res.status).toBe(status);
  return (await res.json()).data as T;
}
/** Asserts a controlled error AND that nothing Prisma-shaped leaked into the body. */
async function err(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  const body = await res.json();
  expect(body.code).toBe(code);
  const raw = JSON.stringify(body);
  expect(raw).not.toMatch(/P2\d{3}/);
  expect(raw.toLowerCase()).not.toContain("prisma");
  return body;
}

const createEntity = async (canonicalKey: string, entityType: string) => {
  const e = await ok<Entity>(await postEntity(jsonRequest(`${BASE}/api/entities`, "POST", { entityType, canonicalKey })), 201);
  created.entities.push(e.id);
  return e;
};
const createVersion = async (entityId: string, body: Record<string, unknown>) =>
  ok<Version>(await postVersion(jsonRequest(`${BASE}/api/entities/${entityId}/versions`, "POST", body), routeParams({ entityId })), 201);
const transition = async (versionId: string, status: string) =>
  ok<Version>(await postStatus(jsonRequest(`${BASE}/api/entity-versions/${versionId}/status`, "POST", { status }), routeParams({ versionId })));
const createKeyword = async (label: string) => {
  const k = await ok<Named & { name: string }>(
    await postKeyword(jsonRequest(`${BASE}/api/keywords`, "POST", { canonicalKey: `test.audit.kw_${label}_${tag}_${++n}`, name: `${label} ${tag}` })), 201);
  created.keywords.push(k.id);
  return k;
};
const createDocument = async (title: string, authorityStatus: string | null) => {
  const d = await ok<Doc>(await postSourceDocument(jsonRequest(`${BASE}/api/source-documents`, "POST", { title, sourceType: "DOCUMENT", authorityStatus })), 201);
  created.documents.push(d.id);
  return d;
};
const assignVersionKeyword = (versionId: string, keywordId: string) =>
  postVersionKeyword(jsonRequest(`${BASE}/api/entity-versions/${versionId}/keywords`, "POST", { keywordId }), routeParams({ versionId }));
const attachSource = (versionId: string, sourceDocumentId: string, sectionLabel?: string) =>
  postVersionSource(jsonRequest(`${BASE}/api/entity-versions/${versionId}/sources`, "POST", { sourceDocumentId, sectionLabel }), routeParams({ versionId }));

async function versionDump(versionId: string) {
  return {
    detail: await ok<Version>(await getVersion(getRequest(`${BASE}/api/entity-versions/${versionId}`), routeParams({ versionId }))),
    keywords: await ok<Assignment[]>(await getVersionKeywords(getRequest(`${BASE}/x`), routeParams({ versionId }))),
    sources: await ok<Reference[]>(await getVersionSources(getRequest(`${BASE}/x`), routeParams({ versionId }))),
  };
}
async function stableDump(entityId: string) {
  const p = routeParams({ entityId });
  return {
    entity: await ok<Entity>(await getEntity(getRequest(`${BASE}/x`), p)),
    aliases: await ok<unknown[]>(await getAliases(getRequest(`${BASE}/x`), p)),
    entityKeywords: await ok<Assignment[]>(await getEntityKeywords(getRequest(`${BASE}/x`), p)),
    relationships: await ok<{ outgoing: unknown[]; incoming: unknown[] }>(await getRelationships(getRequest(`${BASE}/x`), p)),
  };
}
async function fullDump(entityId: string) {
  const versions = await ok<Version[]>(await getVersions(getRequest(`${BASE}/x`), routeParams({ entityId })));
  const perVersion: Record<string, Awaited<ReturnType<typeof versionDump>>> = {};
  for (const v of versions) perVersion[v.id] = await versionDump(v.id);
  return { ...(await stableDump(entityId)), versions, perVersion };
}
async function list(query: string) {
  const res = await listEntities(getRequest(`${BASE}/api/entities?${query}`));
  expect(res.status).toBe(200);
  return (await res.json()) as {
    data: Array<{ entity: Entity; latestRevision: { revisionNumber: number; status: string; displayName: string } | null }>;
    pagination: { page: number; pageSize: number; total: number; totalPages: number };
  };
}

interface Fixture {
  E: Entity; B: Entity; alias: string;
  stableKw: Named & { name: string }; alphaKw: Named & { name: string }; betaKw: Named & { name: string };
  docA: Doc; docB: Doc;
  rev1: Version; rev2: Version; rev3: Version;
  stableBeforeRev2: Awaited<ReturnType<typeof stableDump>>;
  rev1Snapshot: Awaited<ReturnType<typeof versionDump>>;
}
let fx: Fixture;

describe("M1 audit — canonical historical reproducibility scenario, through the HTTP API (prowess_studio_test only)", () => {
  beforeAll(async () => {
    assertRunningAgainstTestDatabase(process.env.DATABASE_URL!);

    const stableKw = await createKeyword("stable");
    const alphaKw = await createKeyword("alpha");
    const betaKw = await createKeyword("beta");
    const docA = await createDocument(`Audit Source A ${tag}`, "GOVERNING");
    const docB = await createDocument(`Audit Source B ${tag}`, "PLAYTEST_REFERENCE");

    const E = await createEntity(`test.audit.historical_rule.${tag}`, "SPELL_EFFECT");
    const B = await createEntity(`test.audit.counterpart.${tag}`, "GENERIC_RULE");

    // Entity-level data.
    const alias = `Legacy Rule Name ${tag}`;
    await ok(await postAlias(jsonRequest(`${BASE}/x`, "POST", { alias }), routeParams({ entityId: E.id })), 201);
    await ok(await postEntityKeyword(jsonRequest(`${BASE}/x`, "POST", { keywordId: stableKw.id }), routeParams({ entityId: E.id })), 201);
    await ok(
      await postRelationship(jsonRequest(`${BASE}/api/relationships`, "POST", {
        sourceEntityId: E.id, targetEntityId: B.id, relationshipType: "REQUIRES", metadata: { note: "non-mechanical annotation" },
      })),
      201,
    );

    // Revision 1 — taken all the way to CANON.
    const rev1 = await createVersion(E.id, {
      displayName: "Historical Rule",
      rulesText: "Historical rules text.",
      structuredData: { value: 10, mode: "old" },
    });
    await ok(await assignVersionKeyword(rev1.id, alphaKw.id), 201);
    await ok(await attachSource(rev1.id, docA.id, "Section A"), 201);
    for (const status of ["IN_REVIEW", "APPROVED", "PLAYTEST", "CANON"]) await transition(rev1.id, status);

    const stableBeforeRev2 = await stableDump(E.id);
    const rev1Snapshot = await versionDump(rev1.id);

    // Revision 2 (parent = Revision 1) stays DRAFT; Revision 3 also descends from Revision 1.
    const rev2 = await createVersion(E.id, {
      displayName: "Revised Rule",
      rulesText: "Revised rules text.",
      structuredData: { value: 20, mode: "new" },
      parentVersionId: rev1.id,
    });
    await ok(await assignVersionKeyword(rev2.id, betaKw.id), 201);
    await ok(await attachSource(rev2.id, docB.id, "Section B"), 201);
    const rev3 = await createVersion(E.id, { displayName: "Branch Rule", parentVersionId: rev1.id });

    fx = { E, B, alias, stableKw, alphaKw, betaKw, docA, docB, rev1, rev2, rev3, stableBeforeRev2, rev1Snapshot };
  }, 60_000);

  afterAll(async () => {
    const versions = await prisma.entityVersion.findMany({ where: { entityId: { in: created.entities } }, select: { id: true } });
    const versionIds = versions.map((v: { id: string }) => v.id);
    await prisma.sourceReference.deleteMany({ where: { entityVersionId: { in: versionIds } } });
    await prisma.entityVersionKeyword.deleteMany({ where: { entityVersionId: { in: versionIds } } });
    await prisma.entityKeyword.deleteMany({ where: { entityId: { in: created.entities } } });
    await prisma.entityRelationship.deleteMany({
      where: { OR: [{ sourceEntityId: { in: created.entities } }, { targetEntityId: { in: created.entities } }] },
    });
    await prisma.entityAlias.deleteMany({ where: { entityId: { in: created.entities } } });
    await prisma.entityVersion.updateMany({ where: { id: { in: versionIds } }, data: { parentVersionId: null } });
    await prisma.entityVersion.deleteMany({ where: { id: { in: versionIds } } });
    await prisma.entity.deleteMany({ where: { id: { in: created.entities } } });
    await prisma.keywordDefinition.deleteMany({ where: { id: { in: created.keywords } } });
    await prisma.sourceDocument.deleteMany({ where: { id: { in: created.documents } } });
  });

  it("§3 stable identity: creating later revisions changes no Entity identity and duplicates no Entity-level data", async () => {
    const after = await stableDump(fx.E.id);
    expect(after).toEqual(fx.stableBeforeRev2); // identity, aliases, Entity Keywords, relationships — all identical
    const versions = await ok<Version[]>(await getVersions(getRequest(`${BASE}/x`), routeParams({ entityId: fx.E.id })));
    expect(versions).toHaveLength(3);
    for (const v of versions) expect(v.entityId).toBe(fx.E.id);
    const sameKey = await list(`canonicalKey=${fx.E.canonicalKey}`);
    expect(sameKey.pagination.total).toBe(1); // still exactly one Entity E
    expect(after.aliases).toHaveLength(1);
    expect(after.entityKeywords).toHaveLength(1);
    expect(after.relationships.outgoing).toHaveLength(1);
  });

  it("§4 historical snapshot: Revision 1 is exactly as authored, and has not acquired Revision 2's content", async () => {
    const again = await versionDump(fx.rev1.id);
    expect(again).toEqual(fx.rev1Snapshot); // byte-for-byte, including updatedAt

    expect(again.detail.displayName).toBe("Historical Rule");
    expect(again.detail.rulesText).toBe("Historical rules text.");
    expect(again.detail.structuredData).toEqual({ value: 10, mode: "old" });
    expect(again.keywords.map((k) => k.keyword.id)).toEqual([fx.alphaKw.id]);
    expect(again.sources.map((s) => s.sourceDocumentId)).toEqual([fx.docA.id]);

    const raw = JSON.stringify(again);
    expect(raw).not.toContain("Revised Rule");
    expect(raw).not.toContain('"value":20');
    expect(raw).not.toContain(fx.betaKw.id);
    expect(raw).not.toContain(fx.docB.id);
  });

  it("§5 immutability: a CANON revision rejects content edits and Version-Keyword changes with a controlled error", async () => {
    const url = `${BASE}/api/entity-versions/${fx.rev1.id}`;
    const params = routeParams({ versionId: fx.rev1.id });
    for (const patch of [{ displayName: "Tampered" }, { rulesText: "Tampered" }, { structuredData: { value: 99 } }]) {
      await err(await patchVersion(jsonRequest(url, "PATCH", patch), params), 409, "ENTITY_VERSION.IMMUTABLE");
    }
    await err(await assignVersionKeyword(fx.rev1.id, fx.betaKw.id), 409, "ENTITY_VERSION.IMMUTABLE");
    await err(
      await deleteVersionKeyword(jsonRequest(`${url}/keywords/${fx.alphaKw.id}`, "DELETE"), routeParams({ versionId: fx.rev1.id, keywordId: fx.alphaKw.id })),
      409,
      "ENTITY_VERSION.IMMUTABLE",
    );
    expect(await versionDump(fx.rev1.id)).toEqual(fx.rev1Snapshot); // nothing changed
  });

  it("§5/§12 provenance on a protected revision remains manageable, without touching its authored content", async () => {
    const e = await createEntity(`test.audit.canon_source.${tag}`, "GENERIC_RULE");
    const v = await createVersion(e.id, { displayName: "Protected", structuredData: { value: 7 }, rulesText: "r" });
    for (const status of ["IN_REVIEW", "APPROVED", "PLAYTEST", "CANON"]) await transition(v.id, status);
    const before = await ok<Version>(await getVersion(getRequest(`${BASE}/x`), routeParams({ versionId: v.id })));

    const doc = await createDocument(`Audit Canon Source ${tag}`, "GOVERNING");
    await ok(await attachSource(v.id, doc.id), 201);

    expect(await ok<Version>(await getVersion(getRequest(`${BASE}/x`), routeParams({ versionId: v.id })))).toEqual(before);
  });

  it("§7 lineage is explicit: Revisions 2 and 3 both descend from Revision 1, never inferred from numbering", async () => {
    const versions = await ok<Version[]>(await getVersions(getRequest(`${BASE}/x`), routeParams({ entityId: fx.E.id })));
    const byRev = new Map(versions.map((v) => [v.revisionNumber, v]));
    expect(byRev.get(1)?.parentVersionId).toBeNull();
    expect(byRev.get(2)?.parentVersionId).toBe(fx.rev1.id);
    expect(byRev.get(3)?.parentVersionId).toBe(fx.rev1.id);
    expect(byRev.get(3)?.parentVersionId).not.toBe(fx.rev2.id);
  });

  it("§8 revision allocation: numbers are 1,2,3 for E, and another Entity independently starts at 1", async () => {
    const versions = await ok<Version[]>(await getVersions(getRequest(`${BASE}/x`), routeParams({ entityId: fx.E.id })));
    expect(versions.map((v) => v.revisionNumber)).toEqual([1, 2, 3]);
    const first = await createVersion(fx.B.id, { displayName: "Counterpart" });
    expect(first.revisionNumber).toBe(1);
  });

  it("§9 aliases resolve the stable Entity (never a Version), across casing/spacing variants, and are not duplicated by revisions", async () => {
    for (const variant of [fx.alias, fx.alias.toLowerCase(), fx.alias.toUpperCase(), `  ${fx.alias.replace(/ /g, "   ")}  `]) {
      const res = await searchAliases(getRequest(`${BASE}/api/entity-aliases/search?alias=${encodeURIComponent(variant)}`));
      const matches = await ok<Array<{ entity: Entity }>>(res);
      expect(matches.map((m) => m.entity.id), variant).toEqual([fx.E.id]);
      const raw = JSON.stringify(matches);
      expect(raw).not.toContain("revisionNumber");
      expect(raw).not.toContain("entityVersionId");
    }
    expect(await ok<unknown[]>(await getAliases(getRequest(`${BASE}/x`), routeParams({ entityId: fx.E.id })))).toHaveLength(1);
  });

  it("§10 keyword scope: Entity / Revision 1 / Revision 2 are distinct layers with no inheritance and no side effects", async () => {
    const entityKeywords = await ok<Assignment[]>(await getEntityKeywords(getRequest(`${BASE}/x`), routeParams({ entityId: fx.E.id })));
    expect(entityKeywords.map((k) => k.keyword.id)).toEqual([fx.stableKw.id]);

    const k1 = (await versionDump(fx.rev1.id)).keywords.map((k) => k.keyword.id);
    const k2 = (await versionDump(fx.rev2.id)).keywords.map((k) => k.keyword.id);
    const k3 = (await versionDump(fx.rev3.id)).keywords.map((k) => k.keyword.id);
    expect(k1).toEqual([fx.alphaKw.id]);
    expect(k2).toEqual([fx.betaKw.id]);
    expect(k3).toEqual([]); // Revision 3 inherits nothing from Revision 1 or the Entity

    // Keywords changed no authored field.
    const rev2 = (await versionDump(fx.rev2.id)).detail;
    expect(rev2.structuredData).toEqual({ value: 20, mode: "new" });
    expect(rev2.status).toBe("DRAFT");
    expect(rev2.revisionNumber).toBe(2);
    expect(rev2.rulesText).toBe("Revised rules text.");
  });

  it("§11 relationships belong to the stable Entity: one row, same on every revision, no inverse, non-mechanical", async () => {
    const e = await ok<{ outgoing: Array<{ relationship: { relationshipType: string; metadata: unknown }; counterpart: Entity }>; incoming: unknown[] }>(
      await getRelationships(getRequest(`${BASE}/x`), routeParams({ entityId: fx.E.id })));
    expect(e.outgoing).toHaveLength(1);
    expect(e.outgoing[0]?.relationship.relationshipType).toBe("REQUIRES");
    expect(e.outgoing[0]?.counterpart.id).toBe(fx.B.id);
    expect(e.incoming).toHaveLength(0);
    expect((await stableDump(fx.E.id)).relationships).toEqual(fx.stableBeforeRev2.relationships);

    const b = await ok<{ outgoing: unknown[]; incoming: unknown[] }>(await getRelationships(getRequest(`${BASE}/x`), routeParams({ entityId: fx.B.id })));
    expect(b.incoming).toHaveLength(1);
    expect(b.outgoing).toHaveLength(0); // no automatically-created inverse

    // The relationship (and its metadata) altered no Version.
    expect((await versionDump(fx.rev1.id)).detail).toEqual(fx.rev1Snapshot.detail);
  });

  it("§12 source provenance is Version-scoped; authority metadata selects/changes nothing", async () => {
    expect((await versionDump(fx.rev1.id)).sources.map((s) => s.sourceDocumentId)).toEqual([fx.docA.id]);
    expect((await versionDump(fx.rev2.id)).sources.map((s) => s.sourceDocumentId)).toEqual([fx.docB.id]);
    expect((await versionDump(fx.rev3.id)).sources).toEqual([]);
    expect(fx.docA.authorityStatus).toBe("GOVERNING");
    expect(fx.docB.authorityStatus).toBe("PLAYTEST_REFERENCE");

    // GOVERNING on Source A did not make Revision 1 "the" version; statuses are exactly what lifecycle set.
    expect((await versionDump(fx.rev1.id)).detail.status).toBe("CANON");
    expect((await versionDump(fx.rev2.id)).detail.status).toBe("DRAFT");
    expect((await versionDump(fx.rev3.id)).detail.status).toBe("DRAFT");
    const found = await list(`canonicalKey=${fx.E.canonicalKey}`);
    expect(found.data[0]?.latestRevision?.revisionNumber).toBe(3); // highest number, not authority/CANON
  });

  it("§18/§20 the integrated API finds E by alias, by any revision's display name, by canonical key, and honors filter semantics", async () => {
    const byAlias = await list(`search=${encodeURIComponent(fx.alias)}`);
    expect(byAlias.data.map((i) => i.entity.id)).toEqual([fx.E.id]);

    // Historical display names are searchable (M1-WO8: ANY revision), AND-ed with the exact key.
    for (const name of ["Historical Rule", "Revised Rule", "Branch Rule"]) {
      const res = await list(`search=${encodeURIComponent(name)}&canonicalKey=${fx.E.canonicalKey}`);
      expect(res.pagination.total, name).toBe(1);
    }
    expect((await list(`canonicalKey=${fx.E.canonicalKey}&entityType=SPELL_EFFECT`)).pagination.total).toBe(1);
    expect((await list(`canonicalKey=${fx.E.canonicalKey}&entityType=GENERIC_RULE`)).pagination.total).toBe(0);

    // status filters the LATEST revision (DRAFT), not "any revision is CANON" — a list-view convenience, not Canon resolution.
    expect((await list(`canonicalKey=${fx.E.canonicalKey}&status=DRAFT`)).pagination.total).toBe(1);
    expect((await list(`canonicalKey=${fx.E.canonicalKey}&status=CANON`)).pagination.total).toBe(0);

    // keyword filter is Entity-level only (documented M1-WO8 scope limitation).
    expect((await list(`canonicalKey=${fx.E.canonicalKey}&keyword=${fx.stableKw.id}`)).pagination.total).toBe(1);
    expect((await list(`canonicalKey=${fx.E.canonicalKey}&keyword=${fx.alphaKw.id}`)).pagination.total).toBe(0);
  });

  it("§17 error contract: controlled errors, correct statuses, no Prisma leakage", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    await err(await getVersion(getRequest(`${BASE}/x`), routeParams({ versionId: missing })), 404, "ENTITY_VERSION.NOT_FOUND");
    await err(await getEntity(getRequest(`${BASE}/x`), routeParams({ entityId: "not-a-uuid" })), 400, "API.INVALID_UUID");
    await err(
      await postEntity(jsonRequest(`${BASE}/api/entities`, "POST", { entityType: "GENERIC_RULE", canonicalKey: fx.E.canonicalKey })),
      409,
      "ENTITY.CANONICAL_KEY_CONFLICT",
    );
    await err(await postEntity(jsonRequest(`${BASE}/api/entities`, "POST", { entityType: "NOT_A_TYPE", canonicalKey: `test.audit.bad.${tag}` })), 400, "ENTITY.INVALID_TYPE");
  });

  it("§19 pagination is deterministic: same state → same ordered page boundaries, no duplicates, no gaps — on both query paths", async () => {
    const term = `auditpage${tag}`;
    const ids: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      const e = await createEntity(`test.audit.page_${tag}_${i}`, "GENERIC_RULE");
      await ok(await postAlias(jsonRequest(`${BASE}/x`, "POST", { alias: `${term} item ${i}` }), routeParams({ entityId: e.id })), 201);
      await createVersion(e.id, { displayName: `Paged ${i}` });
      ids.push(e.id);
    }

    async function walk(query: string) {
      const seen: string[] = [];
      const sizes: number[] = [];
      let total = 0;
      for (let page = 1; ; page += 1) {
        const body = await list(`${query}&page=${page}&pageSize=3`);
        sizes.push(body.data.length);
        seen.push(...body.data.map((i) => i.entity.id));
        total = body.pagination.total;
        if (page >= body.pagination.totalPages) break;
      }
      return { seen, sizes, total };
    }

    const first = await walk(`search=${term}`);
    const second = await walk(`search=${term}`);
    expect(first.sizes).toEqual([3, 3, 1]);
    expect(first.total).toBe(7);
    expect(new Set(first.seen).size).toBe(7); // no duplicates
    expect([...first.seen].sort()).toEqual([...ids].sort()); // no gaps
    expect(second.seen).toEqual(first.seen); // repeatable

    // The status-filter path (JS-side pagination) agrees with the database-paginated path.
    const viaStatus = await walk(`search=${term}&status=DRAFT`);
    expect(viaStatus.seen).toEqual(first.seen);
    expect(viaStatus.total).toBe(7);
  }, 60_000);

  it("§25 read-only: a battery of reads leaves every row — including updatedAt — untouched", async () => {
    const before = await fullDump(fx.E.id);
    await list(`search=${encodeURIComponent(fx.alias)}`);
    await list(`canonicalKey=${fx.E.canonicalKey}&status=DRAFT`);
    await searchAliases(getRequest(`${BASE}/api/entity-aliases/search?alias=${encodeURIComponent(fx.alias)}`));
    await fullDump(fx.E.id);
    await fullDump(fx.B.id);
    expect(await fullDump(fx.E.id)).toEqual(before);
  });

  it("§6 draft independence (RUNS LAST — it edits Revision 2): editing the DRAFT leaves Revision 1 byte-for-byte unchanged", async () => {
    const params = routeParams({ versionId: fx.rev2.id });
    const edited = await ok<Version>(
      await patchVersion(
        jsonRequest(`${BASE}/api/entity-versions/${fx.rev2.id}`, "PATCH", {
          displayName: "Revised Rule (edited)",
          rulesText: "Edited rules text.",
          structuredData: { value: 21, mode: "edited" },
        }),
        params,
      ),
    );
    expect(edited.displayName).toBe("Revised Rule (edited)");
    expect(edited.structuredData).toEqual({ value: 21, mode: "edited" });

    expect(await versionDump(fx.rev1.id)).toEqual(fx.rev1Snapshot);
    expect((await versionDump(fx.rev3.id)).detail.displayName).toBe("Branch Rule");
  });
});
