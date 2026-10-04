import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * Compendium E2E flow (PAS-10 M1-WO9 §36–39). Every fixture is created
 * through the real, public M1-WO8 API (`request.post(...)` against the
 * running server — never a direct database write), using unique
 * `test.compendium.*`-prefixed synthetic canonical keys. This proves the
 * Entity Browser is a genuine API → UI integration, not a UI shell over
 * fabricated data.
 */

let uniqueSuffix = 0;
function unique(label: string): string {
  uniqueSuffix += 1;
  return `test.compendium.${label}.${Date.now()}.${uniqueSuffix}`;
}

async function createEntity(request: APIRequestContext, entityType: string) {
  const response = await request.post("/api/entities", {
    data: { entityType, canonicalKey: unique("entity") },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).data as { id: string; canonicalKey: string; entityType: string };
}

async function createVersion(
  request: APIRequestContext,
  entityId: string,
  body: Record<string, unknown>,
) {
  const response = await request.post(`/api/entities/${entityId}/versions`, { data: body });
  expect(response.ok()).toBe(true);
  return (await response.json()).data as { id: string; revisionNumber: number };
}

test.describe("M1-WO9 Compendium Entity Browser", () => {
  test("full flow: create fixtures via the API, search, filter, open, and navigate through a relationship", async ({
    page,
    request,
  }) => {
    // 1-3: create a synthetic Entity, a Version, and representative related data.
    const entity = await createEntity(request, "SPELL_EFFECT");
    const version = await createVersion(request, entity.id, {
      displayName: "E2E Direct Damage",
      structuredData: { value: 10 },
    });

    const aliasText = `E2E Searchable Alias ${Date.now()}`;
    await request.post(`/api/entities/${entity.id}/aliases`, { data: { alias: aliasText } });

    const keywordResponse = await request.post("/api/keywords", {
      data: { canonicalKey: unique("keyword"), name: "E2E Fire" },
    });
    const keyword = (await keywordResponse.json()).data;
    await request.post(`/api/entities/${entity.id}/keywords`, { data: { keywordId: keyword.id } });

    const counterpart = await createEntity(request, "GENERIC_RULE");
    await request.post("/api/relationships", {
      data: {
        sourceEntityId: entity.id,
        targetEntityId: counterpart.id,
        relationshipType: "REQUIRES",
      },
    });

    const documentResponse = await request.post("/api/source-documents", {
      data: { title: `E2E Test Source ${Date.now()}`, sourceType: "DOCUMENT" },
    });
    const document = (await documentResponse.json()).data;
    await request.post(`/api/entity-versions/${version.id}/sources`, {
      data: { sourceDocumentId: document.id, sectionLabel: "E2E Section", pageReference: "1" },
    });

    // 4. Navigate to /compendium.
    await page.goto("/compendium");
    await expect(page.getByRole("heading", { name: "Compendium" })).toBeVisible();

    // 5. Search and find the Entity — by its ALIAS, proving real M1-WO8
    // search semantics (not client-side filtering of a pre-fetched page).
    await page.getByLabel("Search").fill(aliasText);
    await expect(page.getByTestId("entity-list")).toContainText(entity.canonicalKey, {
      timeout: 10_000,
    });

    // 6. Apply at least one filter.
    await page.getByLabel("Entity Type").selectOption("SPELL_EFFECT");
    await expect(page.getByTestId("entity-list")).toContainText(entity.canonicalKey);

    // 7. Open the Entity.
    await page.getByRole("link", { name: new RegExp(entity.canonicalKey) }).click();
    await expect(page).toHaveURL(new RegExp(`/compendium/entities/${entity.id}$`));

    // 8. Confirm canonical key and Entity Type.
    const identitySection = page.getByTestId("identity-section");
    await expect(identitySection).toContainText(entity.canonicalKey);
    await expect(identitySection).toContainText("Spell Effect");

    // 9. Confirm "Latest Revision" display — never "Current"/"Canon".
    await expect(page.getByRole("heading", { name: "Latest Revision" })).toBeVisible();
    const latestRevisionSection = page.getByTestId("latest-revision-section");
    await expect(latestRevisionSection).toContainText("E2E Direct Damage");
    await expect(latestRevisionSection).toContainText(String(version.revisionNumber));
    await expect(page.locator("body")).not.toContainText("Current Version");
    await expect(page.locator("body")).not.toContainText("Canon Version");
    await expect(page.locator("body")).not.toContainText("Active Version");

    // 10. Confirm representative Alias/Keyword/Relationship/Source information.
    await expect(page.getByTestId("aliases-section")).toContainText(aliasText);
    await expect(page.getByRole("heading", { name: "Entity Keywords" })).toBeVisible();
    await expect(page.getByText("E2E Fire")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Outgoing Relationships" })).toBeVisible();
    await expect(page.getByRole("link", { name: counterpart.canonicalKey })).toBeVisible();
    await expect(page.getByTestId("sources-section")).toContainText(/E2E Test Source/);
    await expect(page.getByTestId("sources-section")).toContainText("E2E Section");

    // 11. Navigate through the counterpart relationship link.
    await page.getByRole("link", { name: counterpart.canonicalKey }).click();
    await expect(page).toHaveURL(new RegExp(`/compendium/entities/${counterpart.id}$`));
    await expect(page.getByTestId("identity-section")).toContainText(counterpart.canonicalKey);
  });

  test("search regression: an EntityVersion display name alone can locate the Entity", async ({
    page,
    request,
  }) => {
    const entity = await createEntity(request, "GENERIC_RULE");
    const displayName = `E2E Unique Display Name ${Date.now()}`;
    await createVersion(request, entity.id, { displayName });

    await page.goto(`/compendium?search=${encodeURIComponent(displayName)}`);
    await expect(page.getByTestId("entity-list")).toContainText(entity.canonicalKey, {
      timeout: 10_000,
    });
  });

  test("pagination regression: changing page requests a new API-backed result set", async ({
    page,
    request,
  }) => {
    const sharedTerm = `e2epage${Date.now()}`;
    const created: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const entity = await createEntity(request, "GENERIC_RULE");
      await request.post(`/api/entities/${entity.id}/aliases`, {
        data: { alias: `${sharedTerm}-${i}` },
      });
      created.push(entity.canonicalKey);
    }

    // pageSize=1 forces 3 distinct pages for 3 results (PAS-10 M1-WO9 §38
    // explicitly permits a smaller pageSize in automated tests).
    await page.goto(`/compendium?search=${sharedTerm}&pageSize=1`);
    await expect(page.getByTestId("pagination")).toContainText("Page 1 of 3", { timeout: 10_000 });
    const firstPageRow = await page.getByTestId("entity-row").first().textContent();

    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page.getByTestId("pagination")).toContainText("Page 2 of 3");
    const secondPageRow = await page.getByTestId("entity-row").first().textContent();

    // Different API-backed rows, not a client-side slice of the same page.
    expect(firstPageRow).not.toEqual(secondPageRow);
  });

  test("URL-state regression: navigating directly to a filtered URL restores the same state", async ({
    page,
    request,
  }) => {
    const entity = await createEntity(request, "GENERIC_RULE");
    const searchTerm = `e2eurlstate${Date.now()}`;
    await request.post(`/api/entities/${entity.id}/aliases`, { data: { alias: searchTerm } });

    await page.goto(`/compendium?search=${searchTerm}&entityType=GENERIC_RULE`);

    await expect(page.getByLabel("Search")).toHaveValue(searchTerm);
    await expect(page.getByLabel("Entity Type")).toHaveValue("GENERIC_RULE");
    await expect(page.getByTestId("entity-list")).toContainText(entity.canonicalKey, {
      timeout: 10_000,
    });
  });
});
