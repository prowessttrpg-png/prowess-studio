import { expect, request as pwRequest, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * M1 audit gate — the central historical-reproducibility browser flow
 * (PAS-10 M1-WO11 §18–25). Fixtures are created through the real HTTP API
 * with synthetic `test.audit.e2e_*` keys; nothing is read from or written to
 * the database directly.
 *
 * Revision 1 ("Historical Rule", value 10 / mode old, Keyword Alpha, Source
 * A) is taken to CANON. Revision 2 ("Revised Rule", value 20 / mode new,
 * Keyword Beta, Source B, parent = Revision 1) stays DRAFT. Entity-level: an
 * alias, a stable Keyword, and E REQUIRES a counterpart Entity.
 */

let counter = 0;
const nextKey = (label: string) => `test.audit.e2e_${label}_${Date.now()}_${++counter}`;

async function post<T>(request: APIRequestContext, url: string, data: unknown, status = 201): Promise<T> {
  const response = await request.post(url, { data });
  expect(response.status(), `POST ${url}`).toBe(status);
  return (await response.json()).data as T;
}

interface Seeded {
  entityId: string; entityKey: string; counterpartKey: string;
  alias: string; stable: string; alpha: string; beta: string; sourceA: string; sourceB: string;
}

async function seedAudit(request: APIRequestContext): Promise<Seeded> {
  const tag = `${Date.now()}${++counter}`;
  const names = {
    alias: `Legacy Rule Name ${tag}`, stable: `Stable ${tag}`, alpha: `Alpha ${tag}`,
    beta: `Beta ${tag}`, sourceA: `Source A ${tag}`, sourceB: `Source B ${tag}`,
  };
  const mk = (label: string, name: string) =>
    post<{ id: string }>(request, "/api/keywords", { canonicalKey: nextKey(label), name });
  const [stable, alpha, beta] = [await mk("stable", names.stable), await mk("alpha", names.alpha), await mk("beta", names.beta)];
  const docA = await post<{ id: string }>(request, "/api/source-documents", { title: names.sourceA, sourceType: "DOCUMENT", authorityStatus: "GOVERNING" });
  const docB = await post<{ id: string }>(request, "/api/source-documents", { title: names.sourceB, sourceType: "DOCUMENT", authorityStatus: "PLAYTEST_REFERENCE" });

  const entityKey = nextKey("rule");
  const counterpartKey = nextKey("counterpart");
  const E = await post<{ id: string }>(request, "/api/entities", { entityType: "SPELL_EFFECT", canonicalKey: entityKey });
  const C = await post<{ id: string }>(request, "/api/entities", { entityType: "GENERIC_RULE", canonicalKey: counterpartKey });

  await post(request, `/api/entities/${E.id}/aliases`, { alias: names.alias });
  await post(request, `/api/entities/${E.id}/keywords`, { keywordId: stable.id });
  await post(request, "/api/relationships", { sourceEntityId: E.id, targetEntityId: C.id, relationshipType: "REQUIRES" });

  const rev1 = await post<{ id: string }>(request, `/api/entities/${E.id}/versions`, {
    displayName: "Historical Rule", rulesText: "Historical rules text.", structuredData: { value: 10, mode: "old" },
  });
  await post(request, `/api/entity-versions/${rev1.id}/keywords`, { keywordId: alpha.id });
  await post(request, `/api/entity-versions/${rev1.id}/sources`, { sourceDocumentId: docA.id });
  for (const status of ["IN_REVIEW", "APPROVED", "PLAYTEST", "CANON"]) {
    await post(request, `/api/entity-versions/${rev1.id}/status`, { status }, 200);
  }

  const rev2 = await post<{ id: string }>(request, `/api/entities/${E.id}/versions`, {
    displayName: "Revised Rule", rulesText: "Revised rules text.", structuredData: { value: 20, mode: "new" }, parentVersionId: rev1.id,
  });
  await post(request, `/api/entity-versions/${rev2.id}/keywords`, { keywordId: beta.id });
  await post(request, `/api/entity-versions/${rev2.id}/sources`, { sourceDocumentId: docB.id });

  return { entityId: E.id, entityKey, counterpartKey, ...names };
}

/** Everything reachable for an Entity through GET endpoints — used to prove reads mutate nothing and history persists. */
async function snapshot(request: APIRequestContext, s: Seeded) {
  const get = async (url: string) => {
    const response = await request.get(url);
    expect(response.ok(), url).toBe(true);
    return (await response.json()).data;
  };
  const versions = await get(`/api/entities/${s.entityId}/versions`);
  const perVersion: Record<string, unknown> = {};
  for (const v of versions as Array<{ id: string }>) {
    perVersion[v.id] = {
      detail: await get(`/api/entity-versions/${v.id}`),
      keywords: await get(`/api/entity-versions/${v.id}/keywords`),
      sources: await get(`/api/entity-versions/${v.id}/sources`),
    };
  }
  return {
    entity: await get(`/api/entities/${s.entityId}`),
    versions,
    aliases: await get(`/api/entities/${s.entityId}/aliases`),
    entityKeywords: await get(`/api/entities/${s.entityId}/keywords`),
    relationships: await get(`/api/entities/${s.entityId}/relationships`),
    perVersion,
  };
}

const group = (page: Page) => page.getByTestId("selected-revision-group");

async function expectRevision1(page: Page, s: Seeded) {
  await expect(page.getByRole("heading", { name: "Selected Revision — Revision 1", exact: true })).toBeVisible();
  const g = group(page);
  await expect(g).toContainText("Historical Rule");
  await expect(g).toContainText("Historical rules text.");
  await expect(g).toContainText(/"value": 10/);
  await expect(g).toContainText(/"mode": "old"/);
  await expect(g).toContainText(s.alpha);
  await expect(g).toContainText(s.sourceA);
  await expect(g).not.toContainText("Revised Rule");
  await expect(g).not.toContainText("Revised rules text.");
  await expect(g).not.toContainText(/"value": 20/);
  await expect(g).not.toContainText(s.beta);
  await expect(g).not.toContainText(s.sourceB);
}

async function expectRevision2(page: Page, s: Seeded) {
  await expect(page.getByRole("heading", { name: "Latest Revision", exact: true })).toBeVisible();
  const g = group(page);
  await expect(g).toContainText("Revised Rule");
  await expect(g).toContainText("Revised rules text.");
  await expect(g).toContainText(/"value": 20/);
  await expect(g).toContainText(/"mode": "new"/);
  await expect(g).toContainText(s.beta);
  await expect(g).toContainText(s.sourceB);
  await expect(g).not.toContainText("Historical Rule");
  await expect(g).not.toContainText(/"value": 10/);
  await expect(g).not.toContainText(s.alpha);
  await expect(g).not.toContainText(s.sourceA);
}

/** Entity-level data must be identical whichever revision is selected. */
async function expectStable(page: Page, s: Seeded) {
  const stable = page.getByTestId("stable-entity-sections");
  await expect(stable.getByTestId("aliases-section")).toContainText(s.alias);
  await expect(stable).toContainText(s.stable);
  await expect(stable.getByRole("link", { name: s.counterpartKey })).toBeVisible();
  await expect(stable.getByRole("heading", { name: "Outgoing Relationships" })).toBeVisible();
  await expect(page.getByTestId("identity-section")).toContainText(s.entityKey);
}

test.describe("M1-WO11 historical reproducibility audit", () => {
  test("central flow: find E, inspect Latest, select Revision 1, Revision 2, go back — Revision 1 reproduces exactly; reads are GET-only and mutate nothing", async ({ page, request }) => {
    const s = await seedAudit(request);
    const before = await snapshot(request, s);

    const apiMethods: string[] = [];
    page.on("request", (r) => {
      if (new URL(r.url()).pathname.startsWith("/api/")) apiMethods.push(r.method());
    });

    // 2–3. /compendium → locate E by its alias → open it.
    await page.goto("/compendium");
    await page.getByLabel("Search").fill(s.alias);
    await expect(page.getByTestId("entity-list")).toContainText(s.entityKey, { timeout: 10_000 });
    await page.getByRole("link", { name: new RegExp(s.entityKey) }).click();
    await expect(page).toHaveURL(new RegExp(`/compendium/entities/${s.entityId}$`));

    // 5. Latest Revision is Revision 2 (highest number) — not "current", not the CANON one.
    await expectRevision2(page, s);
    await expectStable(page, s);

    // 6–8. Select Revision 1: historical rules/data/Keyword/Source; Entity-level data unchanged.
    await page.getByTestId("history-link-1").click();
    await expect(page).toHaveURL(/revision=1/);
    await expectRevision1(page, s);
    await expectStable(page, s);

    // 9–10. Select Revision 2: new Version-specific content; Entity-level data unchanged.
    await page.getByTestId("history-link-2").click();
    await expect(page).toHaveURL(/revision=2/);
    await expectRevision2(page, s);
    await expectStable(page, s);

    // 11–12. Back to Revision 1: the old state reproduces exactly again.
    await page.goBack();
    await expect(page).toHaveURL(/revision=1/);
    await expectRevision1(page, s);
    await expectStable(page, s);

    // §25 no hidden writes: only GETs were issued, and every row is unchanged.
    expect(apiMethods.length).toBeGreaterThan(0);
    expect(apiMethods.filter((m) => m !== "GET")).toEqual([]);
    expect(await snapshot(request, s)).toEqual(before);
  });

  test("a historical URL reproduces in fresh browser contexts and from a fresh API client — data comes from PostgreSQL, not session state", async ({ browser, baseURL, request }) => {
    const s = await seedAudit(request);
    const historicalUrl = `/compendium/entities/${s.entityId}?revision=1`;
    const original = await snapshot(request, s);

    for (let i = 0; i < 2; i += 1) {
      // A brand-new context shares no cookies, storage, cache, or session history.
      const context = await browser.newContext({ baseURL });
      const page = await context.newPage();
      await page.goto(historicalUrl);
      await expectRevision1(page, s);
      await expectStable(page, s);
      await context.close();
    }

    const fresh = await pwRequest.newContext({ baseURL });
    try {
      expect(await snapshot(fresh, s)).toEqual(original);
    } finally {
      await fresh.dispose();
    }
  });

  test("comparison: differences are shown for the Version fields, and stable Entity-level metadata is NOT presented as a Version difference", async ({ page, request }) => {
    const s = await seedAudit(request);
    const before = await snapshot(request, s);
    const apiMethods: string[] = [];
    page.on("request", (r) => {
      if (new URL(r.url()).pathname.startsWith("/api/")) apiMethods.push(r.method());
    });

    await page.goto(`/compendium/entities/${s.entityId}`);
    await page.getByLabel("Revision A").selectOption("1");
    await expect(page).toHaveURL(/compareA=1/);
    await page.getByLabel("Revision B").selectOption("2");
    await expect(page).toHaveURL(/compareB=2/);

    const cmp = page.getByTestId("revision-comparison");
    await expect(cmp).toBeVisible();
    await expect(cmp.getByTestId("compare-display-name-a")).toContainText("Historical Rule");
    await expect(cmp.getByTestId("compare-display-name-b")).toContainText("Revised Rule");
    await expect(cmp.getByTestId("compare-rules-text-a")).toContainText("Historical rules text.");
    await expect(cmp.getByTestId("compare-rules-text-b")).toContainText("Revised rules text.");
    await expect(cmp.getByTestId("compare-structured-data-a")).toContainText(/"value": 10/);
    await expect(cmp.getByTestId("compare-structured-data-b")).toContainText(/"value": 20/);
    await expect(cmp.getByTestId("compare-status-a")).toContainText("Canon");
    await expect(cmp.getByTestId("compare-status-b")).toContainText("Draft");
    await expect(cmp.getByTestId("compare-keywords-only-a")).toContainText(s.alpha);
    await expect(cmp.getByTestId("compare-keywords-only-b")).toContainText(s.beta);
    await expect(cmp.getByTestId("compare-sources-a")).toContainText(s.sourceA);
    await expect(cmp.getByTestId("compare-sources-b")).toContainText(s.sourceB);
    await expect(cmp.getByTestId("compare-field-display-name")).toContainText("Differs between revisions");

    // Entity-level metadata belongs to the Entity, so it must not appear as a Version difference.
    await expect(cmp.getByTestId("compare-keywords-shared")).toContainText("None");
    await expect(cmp).not.toContainText(s.stable);
    await expect(cmp).not.toContainText(s.alias);
    await expect(cmp).not.toContainText(s.counterpartKey);

    expect(apiMethods.filter((m) => m !== "GET")).toEqual([]);
    expect(await snapshot(request, s)).toEqual(before);
  });

  test("the integrated API over real HTTP: create, version, search, filter, fetch by id, inspect history, keywords, relationships, sources", async ({ request }) => {
    const s = await seedAudit(request);
    const getJson = async (url: string, status = 200) => {
      const response = await request.get(url);
      expect(response.status(), url).toBe(status);
      return response.json();
    };

    // Search: alias, and ANY revision's display name (AND-ed with the exact key so leftovers can't interfere).
    expect((await getJson(`/api/entities?search=${encodeURIComponent(s.alias)}`)).data.map((i: { entity: { id: string } }) => i.entity.id)).toEqual([s.entityId]);
    for (const name of ["Historical Rule", "Revised Rule"]) {
      expect((await getJson(`/api/entities?search=${encodeURIComponent(name)}&canonicalKey=${s.entityKey}`)).pagination.total, name).toBe(1);
    }
    // Filters: exact key, type, and status = LATEST revision's status (DRAFT), not "some revision is CANON".
    expect((await getJson(`/api/entities?canonicalKey=${s.entityKey}`)).data[0].latestRevision.revisionNumber).toBe(2);
    expect((await getJson(`/api/entities?canonicalKey=${s.entityKey}&entityType=GENERIC_RULE`)).pagination.total).toBe(0);
    expect((await getJson(`/api/entities?canonicalKey=${s.entityKey}&status=DRAFT`)).pagination.total).toBe(1);
    expect((await getJson(`/api/entities?canonicalKey=${s.entityKey}&status=CANON`)).pagination.total).toBe(0);

    // By id, history ordering, Version-level keywords/sources, Entity-level relationship.
    expect((await getJson(`/api/entities/${s.entityId}`)).data.canonicalKey).toBe(s.entityKey);
    const versions = (await getJson(`/api/entities/${s.entityId}/versions`)).data as Array<{ id: string; revisionNumber: number; parentVersionId: string | null }>;
    expect(versions.map((v) => v.revisionNumber)).toEqual([1, 2]);
    expect(versions[1]?.parentVersionId).toBe(versions[0]?.id);
    expect((await getJson(`/api/entity-versions/${versions[0]?.id}/keywords`)).data.map((k: { keyword: { name: string } }) => k.keyword.name)).toEqual([s.alpha]);
    expect((await getJson(`/api/entity-versions/${versions[1]?.id}/keywords`)).data.map((k: { keyword: { name: string } }) => k.keyword.name)).toEqual([s.beta]);
    expect((await getJson(`/api/entities/${s.entityId}/relationships`)).data.outgoing).toHaveLength(1);
    expect((await getJson(`/api/entity-versions/${versions[0]?.id}/sources`)).data).toHaveLength(1);

    // Error contract over real HTTP: controlled codes, no Prisma leakage.
    for (const [url, status, code] of [
      ["/api/entity-versions/00000000-0000-4000-8000-000000000000", 404, "ENTITY_VERSION.NOT_FOUND"],
      ["/api/entities/not-a-uuid", 400, "API.INVALID_UUID"],
    ] as const) {
      const body = await getJson(url, status);
      expect(body.code).toBe(code);
      expect(JSON.stringify(body)).not.toMatch(/P2\d{3}|prisma/i);
    }
    const dup = await request.post("/api/entities", { data: { entityType: "GENERIC_RULE", canonicalKey: s.entityKey } });
    expect(dup.status()).toBe(409);
    expect((await dup.json()).code).toBe("ENTITY.CANONICAL_KEY_CONFLICT");
  });

  test("pagination over real HTTP is deterministic: repeated walks give identical, duplicate-free, gap-free pages", async ({ request }) => {
    const term = `e2eauditpage${Date.now()}${++counter}`;
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const e = await post<{ id: string }>(request, "/api/entities", { entityType: "GENERIC_RULE", canonicalKey: nextKey(`page${i}`) });
      await post(request, `/api/entities/${e.id}/aliases`, { alias: `${term} item ${i}` });
      ids.push(e.id);
    }
    const walk = async () => {
      const seen: string[] = [];
      for (let page = 1; ; page += 1) {
        const response = await request.get(`/api/entities?search=${term}&page=${page}&pageSize=2`);
        const body = await response.json();
        seen.push(...body.data.map((i: { entity: { id: string } }) => i.entity.id));
        if (page >= body.pagination.totalPages) break;
      }
      return seen;
    };
    const first = await walk();
    expect(new Set(first).size).toBe(5);
    expect([...first].sort()).toEqual([...ids].sort());
    expect(await walk()).toEqual(first);
  });
});
