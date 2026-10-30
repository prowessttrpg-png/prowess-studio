import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * PAS-10 M6-WO2 — UX acceptance for the Compendium Rules Reference, through the REAL Studio UI. Prerequisite content
 * (Entities, revisions, Rulesets, Manifests, a ChangeSet and two Releases) is created through the existing API, exactly
 * as the Canon Manager would; every reading step happens in the browser and sends no write request.
 *
 * A reader opens the Compendium, chooses the Rules Reference and a Ruleset, uses View Latest Release (an exact Release
 * URL), browses and filters the entries, opens an entry pinned at Revision 2 while Revision 3 is the latest revision,
 * follows an exact reference that keeps the Release, switches to the older Release and sees Revision 1, compares the
 * two Releases and finds the no-Release state of an empty Ruleset. Fixture content is test-only (`test.e2e_m6wo2.*`).
 */
let n = 0;
const unique = (label: string) => `test.e2e_m6wo2.${label}_${Date.now()}_${++n}`;
type Id = { id: string };

async function post<T>(request: APIRequestContext, path: string, data?: unknown): Promise<T> {
  const r = await request.post(path, data === undefined ? {} : { data });
  expect(r.ok(), `${path}: ${await r.text()}`).toBe(true);
  return (await r.json()).data as T;
}
async function revision(request: APIRequestContext, entityId: string, displayName: string, structuredData: object, approve = true) {
  const v = await post<Id>(request, `/api/entities/${entityId}/versions`, { displayName, structuredData });
  if (approve) {
    await post(request, `/api/entity-versions/${v.id}/status`, { status: "IN_REVIEW" });
    await post(request, `/api/entity-versions/${v.id}/status`, { status: "APPROVED" });
  }
  return v;
}
async function ruleset(request: APIRequestContext, name: string) {
  const r = await post<Id>(request, "/api/rulesets", { canonicalKey: unique("ruleset"), name, channel: "CORE_PLAYTEST" });
  await post(request, `/api/rulesets/${r.id}/submit-review`);
  await post(request, `/api/rulesets/${r.id}/approve`);
  return r;
}
const effect = (feet: number) => ({
  prowessDefinition: {
    schemaVersion: 1,
    systemFamily: "SPELL",
    definitionKind: "SPELL_EFFECT",
    payload: { effectFamily: "FORCED_MOVEMENT", keywords: [], parameters: {}, compatibility: [], costContributions: [{ contributionKey: "effect.mp", currency: "MP", data: { amount: 2 } }], rules: {}, resolution: { mode: "SAVING_THROW", data: {} }, outcomes: [{ outcomeKey: "push", data: { feet } }] },
  },
});

test("a reader browses an exact Release, its pinned revisions, references and comparison — writing nothing", async ({ page, request }) => {
  const tag = `${Date.now()}`;
  const push = await post<Id & { canonicalKey: string }>(request, "/api/entities", { entityType: "SPELL_EFFECT", canonicalKey: unique("force_push") });
  const r1 = await revision(request, push.id, `Force Push ${tag}`, effect(10));
  const r2 = await revision(request, push.id, `Force Push ${tag}`, effect(15));
  const trait = await post<Id>(request, "/api/entities", { entityType: "SPELL_TRAIT", canonicalKey: unique("piercing") });
  const tv = await revision(request, trait.id, `Piercing ${tag}`, {
    prowessDefinition: { schemaVersion: 1, systemFamily: "SPELL", definitionKind: "SPELL_TRAIT", payload: { traitFamily: "PIERCING", scope: "EFFECT", keywords: [], parameters: {}, compatibility: [], costContributions: [], rules: { pairsWith: { entityId: push.id, entityVersionId: r2.id, canonicalKey: push.canonicalKey, definitionKind: "SPELL_EFFECT", systemFamily: "SPELL" } } } },
  });
  const g = await ruleset(request, `Rules Reference E2E ${tag}`);
  const m = await post<Id>(request, `/api/rulesets/${g.id}/manifests`, { entries: [{ entityId: push.id, entityVersionId: r1.id }, { entityId: trait.id, entityVersionId: tv.id }] });
  const policy = await post<Id>(request, `/api/rulesets/${g.id}/canon-policies`, { name: "P", authorities: [] });
  const relA = await post<Id & { manifestId: string }>(request, `/api/rulesets/${g.id}/releases`, { baseManifestId: m.id, canonPolicyId: policy.id, versionLabel: "0.1.0" });
  const cs = await post<Id>(request, `/api/rulesets/${g.id}/change-sets`, { name: "Push rework", operations: [{ operationType: "REPLACE_ENTITY_VERSION", targetEntityId: push.id, fromEntityVersionId: r1.id, toEntityVersionId: r2.id }] });
  await post(request, `/api/change-sets/${cs.id}/submit-review`);
  await post(request, `/api/change-sets/${cs.id}/approve`);
  const relB = await post<Id>(request, `/api/rulesets/${g.id}/releases`, { baseManifestId: relA.manifestId, canonPolicyId: policy.id, changeSetId: cs.id, versionLabel: "0.2.0" });
  await revision(request, push.id, `Force Push ${tag} (rework)`, effect(99), false); // Revision 3: latest, pinned by no Release
  const empty = await ruleset(request, `Rules Reference Empty ${tag}`);

  const writes: string[] = [];
  page.on("request", (req) => {
    if (req.method() !== "GET") writes.push(`${req.method()} ${req.url()}`);
  });

  // Compendium landing → Rules Reference → Ruleset.
  await page.goto("/compendium");
  await page.getByRole("navigation", { name: "Compendium sections" }).getByRole("link", { name: "Rules Reference" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Rules Reference" })).toBeVisible();
  await page.getByRole("link", { name: `Rules Reference E2E ${tag}` }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Release History" })).toBeVisible();
  await expect(page.getByTestId("reference-release-row")).toHaveCount(2);

  // View Latest Release resolves to the EXACT Release 2 URL.
  await page.getByRole("button", { name: "View Latest Release" }).click();
  await page.waitForURL(`**/compendium/rulesets/${g.id}/releases/${relB.id}`);
  await expect(page.getByRole("heading", { level: 1, name: "Release 2 — 0.2.0" })).toBeVisible();
  await expect(page.getByTestId("reference-integrity")).toContainText("Manifest verified");

  // Server-side facets in the URL.
  await page.getByLabel("Kind").selectOption("SPELL_TRAIT");
  await page.waitForURL(/kind=SPELL_TRAIT/);
  await expect(page.getByTestId("reference-card")).toHaveCount(1);
  await page.getByLabel("Kind").selectOption("");
  await expect(page.getByTestId("reference-card")).toHaveCount(2);

  // The entry is Revision 2 (the pin), while Revision 3 is the latest revision.
  await page.getByRole("link", { name: `Force Push ${tag}` }).click();
  await expect(page.getByTestId("reference-entry-header")).toContainText("Pinned Revision 2");
  await expect(page.getByTestId("reference-pin-indicator")).toContainText("This Release uses Revision 2. Latest Entity Revision is 3.");
  await expect(page.getByRole("heading", { level: 2, name: "Rules Text" })).toBeVisible();
  await expect(page.getByTestId("reference-presenter")).toContainText("Forced Movement FORCED_MOVEMENT");
  await expect(page.getByTestId("reference-presenter")).toContainText("15");

  // Referenced By → the Trait, in the same Release; its exact reference matches this Release's pin.
  await page.getByRole("list", { name: "Referenced By" }).getByRole("link", { name: `Piercing ${tag}` }).click();
  await page.waitForURL(`**/releases/${relB.id}/entities/${trait.id}`);
  await expect(page.getByRole("list", { name: "Referenced Definitions" })).toContainText("Revision 2 (matches this Release)");

  // The older Release pins Revision 1: the same authored reference is now a visible mismatch, never rewritten.
  await page.goto(`/compendium/rulesets/${g.id}/releases/${relA.id}/entities/${trait.id}`);
  await expect(page.getByRole("list", { name: "Referenced Definitions" }).getByTestId("reference-mismatch")).toContainText("the authored reference names Revision 2; this Release pins Revision 1.");
  await page.getByRole("list", { name: "Referenced Definitions" }).getByRole("link", { name: `Force Push ${tag}` }).click();
  await page.waitForURL(`**/releases/${relA.id}/entities/${push.id}`);
  await expect(page.getByTestId("reference-entry-header")).toContainText("Pinned Revision 1");

  // Release Comparison: Release 1 → Release 2 changed one pin; the revision comparison is the existing one.
  await page.goto(`/compendium/rulesets/${g.id}/releases/${relA.id}`);
  await page.getByLabel("Compare with").selectOption(relB.id);
  await expect(page.getByTestId("reference-comparison-counts")).toContainText("0 added · 0 removed · 1 changed revision · 1 unchanged");
  await expect(page.getByRole("link", { name: "Compare revisions" })).toHaveAttribute("href", `/compendium/entities/${push.id}?compareA=1&compareB=2`);

  // A Ruleset without Releases says so, with no fallback.
  await page.goto(`/compendium/rulesets/${empty.id}`);
  await expect(page.getByTestId("reference-no-releases")).toContainText("No Releases yet");

  expect(writes).toEqual([]);
});
