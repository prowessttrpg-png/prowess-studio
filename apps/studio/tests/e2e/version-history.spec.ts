import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Version History E2E flows (PAS-10 M1-WO10 §29, §31–36). Every fixture is
 * created through the real M1-WO8 API against the running server, using
 * unique synthetic `test.compendium.*` keys and per-run suffixed names, so
 * assertions can prove which revision's data is on screen.
 *
 * Heading lookups use `exact: true` because "Latest Revision" is also a
 * prefix of the "Latest Revision Keywords" heading.
 */

let counter = 0;
function unique(label: string): string {
  counter += 1;
  return `test.compendium.${label}.${Date.now()}.${counter}`;
}

async function post<T>(request: APIRequestContext, url: string, data: unknown): Promise<T> {
  const response = await request.post(url, { data });
  expect(response.ok(), `POST ${url} -> ${response.status()}`).toBe(true);
  return (await response.json()).data as T;
}

interface Seeded {
  entityId: string;
  alias: string;
  counterpartKey: string;
  oldName: string;
  newName: string;
  alpha: string;
  beta: string;
  sourceA: string;
  sourceB: string;
}

/** Revision 1 (Old Rule / 10 / Alpha / Source A) and Revision 2 (New Rule / 20 / Beta / Source B). */
async function seedTwoRevisions(request: APIRequestContext): Promise<Seeded> {
  const tag = `${Date.now()}${counter}`;
  const entity = await post<{ id: string }>(request, "/api/entities", {
    entityType: "SPELL_EFFECT",
    canonicalKey: unique("history.entity"),
  });
  const alias = `Stable Alias ${tag}`;
  await post(request, `/api/entities/${entity.id}/aliases`, { alias });

  const counterpart = await post<{ id: string; canonicalKey: string }>(request, "/api/entities", {
    entityType: "GENERIC_RULE",
    canonicalKey: unique("history.counterpart"),
  });
  await post(request, "/api/relationships", {
    sourceEntityId: entity.id,
    targetEntityId: counterpart.id,
    relationshipType: "REQUIRES",
  });

  const names = {
    oldName: `Old Rule ${tag}`,
    newName: `New Rule ${tag}`,
    alpha: `Alpha ${tag}`,
    beta: `Beta ${tag}`,
    sourceA: `Source A ${tag}`,
    sourceB: `Source B ${tag}`,
  };

  const rev1 = await post<{ id: string }>(request, `/api/entities/${entity.id}/versions`, {
    displayName: names.oldName,
    structuredData: { value: 10 },
  });
  const alpha = await post<{ id: string }>(request, "/api/keywords", {
    canonicalKey: unique("history.alpha"),
    name: names.alpha,
  });
  await post(request, `/api/entity-versions/${rev1.id}/keywords`, { keywordId: alpha.id });
  const docA = await post<{ id: string }>(request, "/api/source-documents", {
    title: names.sourceA,
    sourceType: "DOCUMENT",
  });
  await post(request, `/api/entity-versions/${rev1.id}/sources`, { sourceDocumentId: docA.id });

  const rev2 = await post<{ id: string }>(request, `/api/entities/${entity.id}/versions`, {
    displayName: names.newName,
    structuredData: { value: 20 },
    parentVersionId: rev1.id,
  });
  const beta = await post<{ id: string }>(request, "/api/keywords", {
    canonicalKey: unique("history.beta"),
    name: names.beta,
  });
  await post(request, `/api/entity-versions/${rev2.id}/keywords`, { keywordId: beta.id });
  const docB = await post<{ id: string }>(request, "/api/source-documents", {
    title: names.sourceB,
    sourceType: "DOCUMENT",
  });
  await post(request, `/api/entity-versions/${rev2.id}/sources`, { sourceDocumentId: docB.id });

  return { entityId: entity.id, alias, counterpartKey: counterpart.canonicalKey, ...names };
}

const latestHeading = (page: Page) =>
  page.getByRole("heading", { name: "Latest Revision", exact: true });

test.describe("M1-WO10 Version History", () => {
  test("historical independence, URL-addressable selection, and stable Entity-level data", async ({
    page,
    request,
  }) => {
    const s = await seedTwoRevisions(request);
    const group = page.getByTestId("selected-revision-group");

    // 4–5. Direct-load a historical revision; it shows ONLY Revision 1's data.
    await page.goto(`/compendium/entities/${s.entityId}?revision=1`);
    await expect(
      page.getByRole("heading", { name: "Selected Revision — Revision 1", exact: true }),
    ).toBeVisible();
    await expect(group).toContainText(s.oldName);
    await expect(group).toContainText(/"value": 10/);
    await expect(group).toContainText(s.alpha);
    await expect(group).toContainText(s.sourceA);
    await expect(group).not.toContainText(s.newName);
    await expect(group).not.toContainText(/"value": 20/);
    await expect(group).not.toContainText(s.beta);
    await expect(group).not.toContainText(s.sourceB);
    await expect(page.getByTestId("history-link-1")).toHaveAttribute("aria-current", "page");

    // Entity-level data is present on Revision 1 …
    await expect(page.getByTestId("aliases-section")).toContainText(s.alias);
    await expect(page.getByRole("link", { name: s.counterpartKey })).toBeVisible();

    // 6–7. Switch to Revision 2; the URL changes and shows ONLY Revision 2's data.
    await page.getByTestId("history-link-2").click();
    await expect(page).toHaveURL(/revision=2/);
    await expect(latestHeading(page)).toBeVisible();
    await expect(group).toContainText(s.newName);
    await expect(group).toContainText(/"value": 20/);
    await expect(group).toContainText(s.beta);
    await expect(group).toContainText(s.sourceB);
    await expect(group).not.toContainText(s.oldName);
    await expect(group).not.toContainText(/"value": 10/);
    await expect(group).not.toContainText(s.alpha);
    await expect(group).not.toContainText(s.sourceA);

    // … and is IDENTICAL on Revision 2 (stable relationships and aliases).
    await expect(page.getByTestId("aliases-section")).toContainText(s.alias);
    await expect(page.getByRole("link", { name: s.counterpartKey })).toBeVisible();

    // 8–9. Reload the resulting URL; Revision 2 stays selected.
    await page.reload();
    await expect(page).toHaveURL(/revision=2/);
    await expect(page.getByTestId("history-link-2")).toHaveAttribute("aria-current", "page");
    await expect(group).toContainText(s.newName);

    // Browser back/forward walks the selection history.
    await page.goBack();
    await expect(page).toHaveURL(/revision=1/);
    await expect(
      page.getByRole("heading", { name: "Selected Revision — Revision 1", exact: true }),
    ).toBeVisible();
    await expect(group).toContainText(s.oldName);
    await page.goForward();
    await expect(page).toHaveURL(/revision=2/);
    await expect(group).toContainText(s.newName);
  });

  test("a deliberately-selected older revision never snaps back, and offers an explicit way to Latest", async ({
    page,
    request,
  }) => {
    const s = await seedTwoRevisions(request);

    await page.goto(`/compendium/entities/${s.entityId}?revision=1`);
    await expect(latestHeading(page)).toHaveCount(0);
    await page.getByRole("link", { name: "Return to Latest Revision" }).click();

    await expect(page).not.toHaveURL(/revision=/);
    await expect(latestHeading(page)).toBeVisible();
    await expect(page.getByTestId("selected-revision-group")).toContainText(s.newName);
  });

  test("parent lineage follows the real parentVersionId, not revisionNumber - 1", async ({
    page,
    request,
  }) => {
    const entity = await post<{ id: string }>(request, "/api/entities", {
      entityType: "GENERIC_RULE",
      canonicalKey: unique("lineage.entity"),
    });
    const rev1 = await post<{ id: string }>(request, `/api/entities/${entity.id}/versions`, {
      displayName: "Lineage Root",
    });
    await post(request, `/api/entities/${entity.id}/versions`, {
      displayName: "Lineage Child A",
      parentVersionId: rev1.id,
    });
    await post(request, `/api/entities/${entity.id}/versions`, {
      displayName: "Lineage Child B",
      parentVersionId: rev1.id,
    });

    await page.goto(`/compendium/entities/${entity.id}?revision=3`);
    const parent = page.getByTestId("revision-parent");
    await expect(parent).toContainText("Revision 1");
    await expect(parent).not.toContainText("Revision 2");
    await expect(parent.getByRole("link")).toHaveAttribute("href", /revision=1/);

    // The parent is navigable, and the root has no parent.
    await parent.getByRole("link").click();
    await expect(page).toHaveURL(/revision=1/);
    await expect(page.getByTestId("revision-parent")).toContainText("None");
  });

  test("comparison: A/B identity, independent values, keyword categories, version-specific sources; restored from the URL", async ({
    page,
    request,
  }) => {
    const s = await seedTwoRevisions(request);
    await page.goto(`/compendium/entities/${s.entityId}`);

    await page.getByLabel("Revision A").selectOption("1");
    // Wait for the first selection to land in the URL before the second, so
    // the second change builds on it rather than racing it.
    await expect(page).toHaveURL(/compareA=1/);
    await page.getByLabel("Revision B").selectOption("2");
    await expect(page).toHaveURL(/compareB=2/);

    const verifyComparison = async () => {
      const cmp = page.getByTestId("revision-comparison");
      await expect(cmp).toBeVisible();
      await expect(cmp.getByTestId("compare-display-name-a")).toContainText("Revision A (Revision 1)");
      await expect(cmp.getByTestId("compare-display-name-a")).toContainText(s.oldName);
      await expect(cmp.getByTestId("compare-display-name-b")).toContainText("Revision B (Revision 2)");
      await expect(cmp.getByTestId("compare-display-name-b")).toContainText(s.newName);
      await expect(cmp.getByTestId("compare-structured-data-a")).toContainText(/"value": 10/);
      await expect(cmp.getByTestId("compare-structured-data-a")).not.toContainText(/"value": 20/);
      await expect(cmp.getByTestId("compare-structured-data-b")).toContainText(/"value": 20/);
      await expect(cmp.getByTestId("compare-keywords-only-a")).toContainText(s.alpha);
      await expect(cmp.getByTestId("compare-keywords-only-a")).not.toContainText(s.beta);
      await expect(cmp.getByTestId("compare-keywords-only-b")).toContainText(s.beta);
      await expect(cmp.getByTestId("compare-keywords-shared")).toContainText("None");
      await expect(cmp.getByTestId("compare-sources-a")).toContainText(s.sourceA);
      await expect(cmp.getByTestId("compare-sources-a")).not.toContainText(s.sourceB);
      await expect(cmp.getByTestId("compare-sources-b")).toContainText(s.sourceB);
    };
    await verifyComparison();

    // Direct-load / refresh restores the same comparison and selector values.
    await page.reload();
    await verifyComparison();
    await expect(page.getByLabel("Revision A")).toHaveValue("1");
    await expect(page.getByLabel("Revision B")).toHaveValue("2");
  });

  test("an unknown revision fails clearly instead of silently showing Latest", async ({
    page,
    request,
  }) => {
    const s = await seedTwoRevisions(request);
    await page.goto(`/compendium/entities/${s.entityId}?revision=999`);

    const notFound = page.getByTestId("revision-not-found");
    await expect(notFound).toBeVisible();
    await expect(notFound).toContainText("Revision 999");
    await expect(latestHeading(page)).toHaveCount(0);
    await expect(page.getByTestId("identity-section")).toBeVisible();

    await notFound.getByRole("link", { name: "Return to Latest Revision" }).click();
    await expect(page).not.toHaveURL(/revision=/);
    await expect(latestHeading(page)).toBeVisible();
  });

  test("single-version and zero-version Entities render safely", async ({ page, request }) => {
    const single = await post<{ id: string }>(request, "/api/entities", {
      entityType: "GENERIC_RULE",
      canonicalKey: unique("single.entity"),
    });
    await post(request, `/api/entities/${single.id}/versions`, { displayName: "Only Revision" });
    await page.goto(`/compendium/entities/${single.id}`);
    await expect(page.getByTestId("history-entry")).toHaveCount(1);
    await expect(page.getByTestId("comparison-unavailable")).toBeVisible();
    await expect(page.getByLabel("Revision A")).toHaveCount(0);

    const empty = await post<{ id: string }>(request, "/api/entities", {
      entityType: "GENERIC_RULE",
      canonicalKey: unique("empty.entity"),
    });
    await page.goto(`/compendium/entities/${empty.id}`);
    await expect(page.getByText("No revisions")).toBeVisible();
    await expect(page.getByTestId("version-history")).toHaveCount(0);
    await expect(page.getByTestId("comparison-controls")).toHaveCount(0);
  });
});

test.describe("M1-WO10 mobile regression", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Version History stays usable at a narrow width, and the shell navigation still works", async ({
    page,
    request,
  }) => {
    const s = await seedTwoRevisions(request);
    await page.goto(`/compendium/entities/${s.entityId}`);

    // Version History is reachable and selecting another revision works.
    await expect(page.getByRole("navigation", { name: "Version History" })).toBeVisible();
    await expect(latestHeading(page)).toBeVisible();
    await page.getByTestId("history-link-1").click();
    await expect(page).toHaveURL(/revision=1/);
    const group = page.getByTestId("selected-revision-group");
    await expect(group).toContainText(s.oldName);
    await expect(group).not.toContainText(s.newName);

    // No horizontal page scroll is needed to use the history/detail content.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    // Primary navigation remains usable via the shell's accessible toggle.
    const toggle = page.getByRole("button", { name: /navigation menu/i });
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("nav-link-compendium")).toBeVisible();
  });

  test("comparison stacks vertically at a narrow width without horizontal scroll", async ({
    page,
    request,
  }) => {
    const s = await seedTwoRevisions(request);
    await page.goto(`/compendium/entities/${s.entityId}?compareA=1&compareB=2`);
    const cmp = page.getByTestId("revision-comparison");
    await expect(cmp).toBeVisible();

    const a = await cmp.getByTestId("compare-display-name-a").boundingBox();
    const b = await cmp.getByTestId("compare-display-name-b").boundingBox();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    // Stacked: B sits below A rather than beside it.
    expect(b!.y).toBeGreaterThan(a!.y + a!.height - 1);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
