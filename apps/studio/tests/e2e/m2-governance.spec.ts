import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * PAS-10 M2-WO10 §72–§82 — the Ruleset & Canon governance workflow through the REAL Studio UI.
 * Prerequisite Entities / Versions / Source Documents (which have no M2 creation screen) are created through the
 * existing API; every governance step is performed in the browser. Two checks need the database itself — the
 * no-write fingerprint (§74, §78) and test-only hash corruption (§81) — and use the guarded @prowess/db test
 * client against prowess_studio_test only.
 */
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/prowess_studio_test";

let n = 0;
const unique = (label: string) => `test.m2ui.${label}.${Date.now()}.${++n}`;
const UUID = "[0-9a-f-]{36}";

async function post<T>(request: APIRequestContext, path: string, data?: unknown): Promise<T> {
  const r = await request.post(path, data === undefined ? {} : { data });
  expect(r.ok(), `${path}: ${await r.text()}`).toBe(true);
  return (await r.json()).data as T;
}
type Id = { id: string };
async function entityWithVersions(request: APIRequestContext, ...names: string[]) {
  const entity = await post<Id & { canonicalKey: string }>(request, "/api/entities", { entityType: "GENERIC_RULE", canonicalKey: unique("entity") });
  const versions: Id[] = [];
  for (const displayName of names) {
    const v = await post<Id>(request, `/api/entities/${entity.id}/versions`, { displayName });
    // M2-WO12 F1: published Versions must be content-frozen — moved through the normal lifecycle API.
    await post(request, `/api/entity-versions/${v.id}/status`, { status: "IN_REVIEW" });
    await post(request, `/api/entity-versions/${v.id}/status`, { status: "APPROVED" });
    versions.push(v);
  }
  return { entity, versions };
}
async function sourceDocument(request: APIRequestContext, title: string) {
  return post<Id>(request, "/api/source-documents", { title: `${title} ${unique("doc")}`, sourceType: "DOCUMENT" });
}
async function approvedRuleset(request: APIRequestContext, name: string, extra: Record<string, unknown> = {}) {
  const r = await post<Id>(request, "/api/rulesets", { canonicalKey: unique("ruleset"), name, channel: "CORE_PLAYTEST", ...extra });
  await post(request, `/api/rulesets/${r.id}/submit-review`);
  await post(request, `/api/rulesets/${r.id}/approve`);
  return r;
}
/** Collects every non-GET request the page sends, to prove read-only interactions write nothing through the app. */
function trackWrites(page: Page) {
  const writes: string[] = [];
  page.on("request", (req) => {
    if (req.method() !== "GET") writes.push(`${req.method()} ${req.url()}`);
  });
  return writes;
}
/**
 * A content fingerprint of the rows THIS test owns: its Rulesets' governance records and its Entities' Versions.
 * Scoped deliberately — CI runs spec files in parallel workers against one database, so a whole-table
 * fingerprint would also see other tests' fixtures (the first CI run proved it). The whole-database, serial
 * read-only proof for impact analysis lives in the API integration suite (m2-change-set-api).
 */
async function dbFingerprint(scope: { rulesetIds: string[]; entityIds: string[] }): Promise<string> {
  const { prisma, assertRunningAgainstTestDatabase } = await import("@prowess/db");
  assertRunningAgainstTestDatabase(process.env.DATABASE_URL!);
  const R = "SELECT id FROM rulesets WHERE id = ANY($1::uuid[])";
  const queries: Record<string, string> = {
    rulesets: `SELECT t FROM rulesets t WHERE t.id IN (${R})`,
    ruleset_manifests: `SELECT t FROM ruleset_manifests t WHERE t.ruleset_id IN (${R})`,
    ruleset_manifest_entries: `SELECT t FROM ruleset_manifest_entries t WHERE t.manifest_id IN (SELECT id FROM ruleset_manifests WHERE ruleset_id IN (${R}))`,
    canon_policies: `SELECT t FROM canon_policies t WHERE t.ruleset_id IN (${R})`,
    source_authority_records: `SELECT t FROM source_authority_records t WHERE t.canon_policy_id IN (SELECT id FROM canon_policies WHERE ruleset_id IN (${R}))`,
    rule_conflicts: `SELECT t FROM rule_conflicts t WHERE t.ruleset_id IN (${R})`,
    rule_conflict_candidates: `SELECT t FROM rule_conflict_candidates t WHERE t.rule_conflict_id IN (SELECT id FROM rule_conflicts WHERE ruleset_id IN (${R}))`,
    canon_decisions: `SELECT t FROM canon_decisions t WHERE t.ruleset_id IN (${R})`,
    canon_decision_selections: `SELECT t FROM canon_decision_selections t WHERE t.canon_decision_id IN (SELECT id FROM canon_decisions WHERE ruleset_id IN (${R}))`,
    change_sets: `SELECT t FROM change_sets t WHERE t.ruleset_id IN (${R})`,
    change_set_operations: `SELECT t FROM change_set_operations t WHERE t.ruleset_id IN (${R})`,
    ruleset_releases: `SELECT t FROM ruleset_releases t WHERE t.ruleset_id IN (${R})`,
    entity_versions: "SELECT t FROM entity_versions t WHERE t.entity_id = ANY($1::uuid[])",
  };
  const parts: string[] = [];
  for (const [table, sql] of Object.entries(queries)) {
    // Each query binds exactly one array parameter: the Ruleset ids, or (for entity_versions) the Entity ids.
    const [row] = await prisma.$queryRawUnsafe<Array<{ h: string; n: number }>>(
      `SELECT md5(coalesce(string_agg(q.t::text, '|' ORDER BY q.t::text), '')) AS h, count(*)::int AS n FROM (${sql}) q`,
      table === "entity_versions" ? scope.entityIds : scope.rulesetIds,
    );
    parts.push(`${table}:${row?.n}:${row?.h}`);
  }
  return parts.join(";");
}
async function confirm(page: Page, label: string, confirmLabel = `Confirm: ${label}`) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: confirmLabel, exact: true }).click();
}
async function pickEntity(page: Page, canonicalKey: string) {
  await page.getByRole("searchbox").first().fill(canonicalKey);
  await page.getByRole("button", { name: new RegExp(canonicalKey.replace(/\./g, "\\.")) }).click();
}

test.describe("M2-WO10 Ruleset & Canon governance UI", () => {
  test("the complete governance flow through the UI (§72)", async ({ page, request }) => {
    test.setTimeout(180_000);
    const a = await entityWithVersions(request, "Evocation", "Emission");
    const [a1, a2] = a.versions as [Id, Id];
    const doc = await sourceDocument(request, "Spellcasting");

    // 1–3 Ruleset: create, submit, approve
    await page.goto("/developer/rulesets");
    await page.getByLabel("Canonical key").fill(unique("flow"));
    await page.getByLabel("Name", { exact: true }).fill("UI Flow Ruleset");
    await page.getByRole("button", { name: "Create Ruleset" }).click();
    await page.waitForURL(new RegExp(`/developer/rulesets/${UUID}$`));
    const rulesetUrl = page.url();
    await expect(page.getByTestId("badge-ruleset-status").first()).toHaveText("DRAFT");
    await confirm(page, "Submit for Review");
    await expect(page.getByTestId("badge-ruleset-status").first()).toHaveText("IN REVIEW");
    await confirm(page, "Approve");
    await expect(page.getByTestId("badge-ruleset-status").first()).toHaveText("APPROVED");

    // 4 Manifest from exact Versions
    await page.getByRole("navigation", { name: "Ruleset sections" }).getByRole("link", { name: "Manifests", exact: true }).click();
    await page.getByRole("button", { name: "Add entry" }).click();
    await pickEntity(page, a.entity.canonicalKey);
    await page.getByLabel("Exact Version").selectOption(a1.id);
    await page.getByRole("button", { name: "Create Manifest" }).click();
    await page.waitForURL(new RegExp(`/manifests/${UUID}$`));
    const manifestId = page.url().split("/").pop()!;
    await expect(page.getByTestId("explicit-entries")).toContainText("Evocation");

    // 5 Canon Policy
    await page.getByRole("navigation", { name: "Ruleset sections" }).getByRole("link", { name: "Canon Policy", exact: true }).click();
    await page.getByLabel("Name", { exact: true }).fill("Core Policy");
    await page.getByRole("button", { name: "Add authority record" }).click();
    await page.getByLabel("Source Document (record 1)").selectOption(doc.id);
    await page.getByLabel("Authority status").selectOption("GOVERNING");
    await page.getByRole("button", { name: "Create Canon Policy" }).click();
    await page.waitForURL(new RegExp(`/policies/${UUID}$`));
    const policyId = page.url().split("/").pop()!;

    // 6 Rule Conflict
    await page.getByRole("navigation", { name: "Ruleset sections" }).getByRole("link", { name: "Conflicts", exact: true }).click();
    await pickEntity(page, a.entity.canonicalKey);
    await page.getByLabel("Title").fill("Affinity naming conflict");
    await page.getByLabel("Candidate 1: exact Version").selectOption(a1.id);
    await page.getByLabel("Candidate 2: exact Version").selectOption(a2.id);
    await page.getByRole("button", { name: "Record conflict" }).click();
    await page.waitForURL(new RegExp(`/conflicts/${UUID}$`));
    await expect(page.getByTestId("badge-conflict-status").first()).toHaveText("OPEN");

    // 7 Canon Decision: SELECT_RULE A2
    await page.getByLabel("Canon Policy").selectOption(policyId);
    await page.getByLabel("Decision type").selectOption("SELECT_RULE");
    await page.getByRole("radio", { name: /r2 — Emission/ }).check();
    await page.getByLabel("Rationale").fill("Playtest feedback favours Emission.");
    await expect(page.getByTestId("decision-preview")).toContainText("SELECT_RULE");
    await page.getByRole("button", { name: "Create Canon Decision" }).click();
    await expect(page.getByTestId("badge-conflict-status").first()).toHaveText("RESOLVED");
    await expect(page.getByTestId("candidates")).toContainText("Evocation"); // evidence stays visible
    const manifest = await (await request.get(`/api/ruleset-manifests/${manifestId}`)).json();
    expect(manifest.data.entries[0].entityVersionId).toBe(a1.id); // the decision changed no manifest (§77)

    // 8 Propose ChangeSet from the decision
    await page.getByRole("link", { name: /SELECT_RULE → RESOLVED/ }).click();
    await page.waitForURL(new RegExp(`/decisions/${UUID}$`));
    const decisionUrl = page.url();
    await page.getByRole("link", { name: "Propose a ChangeSet from this decision" }).click();
    await page.getByLabel("Target Manifest (optional)").selectOption(manifestId);
    await page.getByLabel("Name", { exact: true }).fill("Apply Emission");
    await page.getByRole("button", { name: "Propose ChangeSet" }).click();
    await page.waitForURL(new RegExp(`/change-sets/${UUID}$`));
    const changeSetId = page.url().split("/").pop()!;
    await expect(page.getByText("REPLACE_ENTITY_VERSION")).toBeVisible();

    // 9 Impact — read-only (§78)
    const writes = trackWrites(page);
    const scope = { rulesetIds: [rulesetUrl.split("/").pop()!], entityIds: [a.entity.id] };
    const before = await dbFingerprint(scope);
    expect(before).toMatch(/rule_conflicts:1:/); // the scope really contains this test's governance rows
    await page.getByRole("button", { name: "Analyze Impact" }).click();
    await expect(page.locator('[data-derivation="LIVE"]')).toBeVisible();
    await expect(page.locator('[data-category="DIRECT_ENTITY"] summary')).toContainText("(1)");
    expect(writes).toEqual([]);
    expect(await dbFingerprint(scope)).toBe(before);

    // 10–11 Review
    await confirm(page, "Submit for Review");
    await expect(page.getByTestId("badge-change-set-status")).toHaveText("READY FOR REVIEW");
    await confirm(page, "Approve");
    await expect(page.getByTestId("badge-change-set-status")).toHaveText("APPROVED");

    // 12 Publish
    await page.getByRole("navigation", { name: "Ruleset sections" }).getByRole("link", { name: "Releases", exact: true }).click();
    await page.getByLabel("Base Manifest").selectOption(manifestId);
    await page.getByLabel("Canon Policy").selectOption(policyId);
    await page.getByLabel("Approved ChangeSet (optional)").selectOption(changeSetId);
    await page.getByLabel("Version label").fill("Core Playtest 1");
    await page.getByRole("button", { name: "Publish Release" }).click();
    await expect(page.getByTestId("publish-summary")).toContainText("Core Playtest 1");
    await page.getByRole("dialog").getByRole("button", { name: "Publish", exact: true }).click();
    await page.waitForURL(new RegExp(`/releases/${UUID}$`));
    const releaseUrl = page.url();

    // 13–14 Release detail + hash
    await expect(page.getByRole("heading", { name: /Release 1 — Core Playtest 1/ })).toBeVisible();
    const releaseManifestId = (await page.getByTestId("release-manifest-link").textContent())!.trim();
    expect(releaseManifestId).not.toBe(manifestId); // a NEW manifest (§79)
    await page.getByRole("button", { name: "Verify Manifest Hash" }).click();
    await expect(page.getByTestId("hash-result")).toContainText("Verified ✓");
    await expect(page.getByTestId("badge-ruleset-status").first()).toHaveText("PUBLISHED");
    const base = await (await request.get(`/api/ruleset-manifests/${manifestId}`)).json();
    expect(base.data.entries[0].entityVersionId).toBe(a1.id); // base unchanged (§79)

    // 15 Second release, then compare
    await page.getByRole("navigation", { name: "Ruleset sections" }).getByRole("link", { name: "Releases", exact: true }).click();
    await page.getByLabel("Base Manifest").selectOption(releaseManifestId);
    await page.getByLabel("Canon Policy").selectOption(policyId);
    await page.getByLabel("Version label").fill("Core Playtest 2");
    await page.getByRole("button", { name: "Publish Release" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Publish", exact: true }).click();
    await page.waitForURL(new RegExp(`/releases/${UUID}$`));
    await page.getByLabel("Other Release").selectOption({ label: "Release 1 — Core Playtest 1" });
    await page.getByRole("button", { name: "Compare", exact: true }).click();
    await expect(page.getByTestId("release-diff")).toContainText("Unchanged: 1");

    // §73 historical URLs in a FRESH browser context
    const fresh = await page.context().browser()!.newContext({ baseURL: new URL(page.url()).origin });
    const p2 = await fresh.newPage();
    for (const [url, heading] of [
      [`${rulesetUrl}/manifests/${manifestId}`, /Manifest v1/],
      [`${rulesetUrl}/policies/${policyId}`, /Policy v1 — Core Policy/],
      [decisionUrl, /SELECT_RULE/],
      [releaseUrl, /Release 1 — Core Playtest 1/],
    ] as const) {
      await p2.goto(url);
      await expect(p2.getByRole("heading", { name: heading })).toBeVisible();
    }
    // The fresh context is disposed with the browser at teardown (no explicit close needed).
  });

  test("the top-bar selector only changes the VIEWING context — no write, no DB change (§71, §74)", async ({ page, request }) => {
    const one = await approvedRuleset(request, "Selector One");
    const two = await approvedRuleset(request, "Selector Two");
    await page.goto(`/developer/rulesets/${one.id}`);
    await expect(page.getByRole("heading", { name: "Selector One" })).toBeVisible();
    const selector = page.getByTestId("topbar-ruleset");
    await expect(selector).toHaveValue(one.id);
    const writes = trackWrites(page);
    const scope = { rulesetIds: [one.id, two.id], entityIds: [] };
    const before = await dbFingerprint(scope);
    expect(before).toMatch(/rulesets:2:/);
    await selector.selectOption(two.id);
    await page.waitForURL(`**/developer/rulesets/${two.id}`);
    await expect(page.getByRole("heading", { name: "Selector Two" })).toBeVisible();
    expect(writes).toEqual([]);
    expect(await dbFingerprint(scope)).toBe(before);
    await expect(page.locator(".prowess-topbar")).not.toContainText(/Active Ruleset|Current Ruleset/);
  });

  test("explicit vs effective composition and inheritance provenance are distinct (§75)", async ({ page, request }) => {
    const parent = await approvedRuleset(request, "Parent");
    const child = await post<Id>(request, "/api/rulesets", { canonicalKey: unique("child"), name: "Child", channel: "CORE_PLAYTEST", parentRulesetId: parent.id });
    const a = await entityWithVersions(request, "A1", "A2");
    const b = await entityWithVersions(request, "B1");
    const pm = await post<Id>(request, `/api/rulesets/${parent.id}/manifests`, { entries: [{ entityId: a.entity.id, entityVersionId: a.versions[0]!.id }, { entityId: b.entity.id, entityVersionId: b.versions[0]!.id }] });
    const cm = await post<Id>(request, `/api/rulesets/${child.id}/manifests`, { parentManifestId: pm.id, entries: [{ entityId: a.entity.id, entityVersionId: a.versions[1]!.id }] });
    await page.goto(`/developer/rulesets/${child.id}/manifests/${cm.id}`);
    await expect(page.getByTestId("explicit-entries").locator("li")).toHaveCount(1);
    const effective = page.getByTestId("effective-entries");
    await expect(effective.locator("li")).toHaveCount(2);
    await expect(effective.locator('li[data-source="INHERITED"]')).toContainText("depth 1");
    await expect(effective.locator('li[data-source="EXPLICIT"]')).toContainText("A2");
  });

  test("authority resolution shows EXACT / GLOBAL_FALLBACK / UNRESOLVED (§76)", async ({ page, request }) => {
    const r = await approvedRuleset(request, "Authority");
    const [d1, d2, d3] = [await sourceDocument(request, "Exact"), await sourceDocument(request, "Global"), await sourceDocument(request, "None")];
    const policy = await post<Id>(request, `/api/rulesets/${r.id}/canon-policies`, {
      name: "Authority Policy",
      authorities: [{ sourceDocumentId: d1.id, scopeKey: "spell.affinity", authorityStatus: "GOVERNING" }, { sourceDocumentId: d2.id, scopeKey: "global", authorityStatus: "REFERENCE_ONLY" }],
    });
    await page.goto(`/developer/rulesets/${r.id}/policies/${policy.id}`);
    for (const [doc, expected] of [[d1.id, "EXACT"], [d2.id, "GLOBAL FALLBACK"], [d3.id, "UNRESOLVED"]] as const) {
      await page.getByLabel("Source Document").selectOption(doc);
      await page.getByLabel("Scope key").fill("spell.affinity");
      await page.getByRole("button", { name: "Resolve" }).click();
      await expect(page.getByTestId("authority-result")).toContainText(expected);
    }
  });

  test("a stale publication shows a readable 409 with its domain code (§80)", async ({ page, request }) => {
    const r = await approvedRuleset(request, "Stale");
    const a = await entityWithVersions(request, "A1", "A2", "A3");
    const m = await post<Id>(request, `/api/rulesets/${r.id}/manifests`, { entries: [{ entityId: a.entity.id, entityVersionId: a.versions[2]!.id }] });
    const p = await post<Id>(request, `/api/rulesets/${r.id}/canon-policies`, { name: "P", authorities: [] });
    const cs = await post<Id>(request, `/api/rulesets/${r.id}/change-sets`, { name: "stale", operations: [{ operationType: "REPLACE_ENTITY_VERSION", targetEntityId: a.entity.id, fromEntityVersionId: a.versions[0]!.id, toEntityVersionId: a.versions[1]!.id }] });
    await post(request, `/api/change-sets/${cs.id}/submit-review`);
    await post(request, `/api/change-sets/${cs.id}/approve`);
    await page.goto(`/developer/rulesets/${r.id}/releases`);
    await page.getByLabel("Base Manifest").selectOption(m.id);
    await page.getByLabel("Canon Policy").selectOption(p.id);
    await page.getByLabel("Approved ChangeSet (optional)").selectOption(cs.id);
    await page.getByLabel("Version label").fill("stale");
    await page.getByRole("button", { name: "Publish Release" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page.getByTestId("error-code")).toHaveText("RULESET_RELEASE.STALE_CHANGE_SET");
    await expect(page.getByTestId("error-panel")).toContainText("no longer matches the base Manifest");
  });

  test("a tampered release shows HASH MISMATCH, not a failed request (§81)", async ({ page, request }) => {
    const r = await approvedRuleset(request, "Tamper");
    const a = await entityWithVersions(request, "A1", "A2");
    const m = await post<Id>(request, `/api/rulesets/${r.id}/manifests`, { entries: [{ entityId: a.entity.id, entityVersionId: a.versions[0]!.id }] });
    const p = await post<Id>(request, `/api/rulesets/${r.id}/canon-policies`, { name: "P", authorities: [] });
    const rel = await post<Id & { manifestId: string }>(request, `/api/rulesets/${r.id}/releases`, { baseManifestId: m.id, canonPolicyId: p.id, versionLabel: "t" });
    const { prisma, assertRunningAgainstTestDatabase } = await import("@prowess/db");
    assertRunningAgainstTestDatabase(process.env.DATABASE_URL!);
    const entry = await prisma.rulesetManifestEntry.findFirstOrThrow({ where: { manifestId: rel.manifestId } });
    try {
      await prisma.$executeRaw`UPDATE ruleset_manifest_entries SET entity_version_id = ${a.versions[1]!.id}::uuid WHERE id = ${entry.id}::uuid`;
      await page.goto(`/developer/rulesets/${r.id}/releases/${rel.id}`);
      await page.getByRole("button", { name: "Verify Manifest Hash" }).click();
      await expect(page.getByTestId("hash-result")).toContainText("HASH MISMATCH");
      await expect(page.getByTestId("error-panel")).toHaveCount(0);
    } finally {
      await prisma.$executeRaw`UPDATE ruleset_manifest_entries SET entity_version_id = ${entry.entityVersionId}::uuid WHERE id = ${entry.id}::uuid`;
    }
  });

  test("mobile: sections, a conflict, a ChangeSet and a release stay usable without page-level horizontal overflow (§82)", async ({ browser, request, baseURL }) => {
    const r = await approvedRuleset(request, "Mobile Ruleset With A Fairly Long Name");
    const a = await entityWithVersions(request, "A1", "A2");
    const m = await post<Id>(request, `/api/rulesets/${r.id}/manifests`, { entries: [{ entityId: a.entity.id, entityVersionId: a.versions[0]!.id }] });
    const p = await post<Id>(request, `/api/rulesets/${r.id}/canon-policies`, { name: "P", authorities: [] });
    const c = await post<Id>(request, `/api/rulesets/${r.id}/rule-conflicts`, { entityId: a.entity.id, conflictType: "OTHER", severity: "LOW", title: "Mobile conflict", candidates: [{ entityVersionId: a.versions[0]!.id }, { entityVersionId: a.versions[1]!.id }] });
    const cs = await post<Id>(request, `/api/rulesets/${r.id}/change-sets`, { name: "Mobile CS", operations: [{ operationType: "NO_CHANGE" }] });
    const rel = await post<Id>(request, `/api/rulesets/${r.id}/releases`, { baseManifestId: m.id, canonPolicyId: p.id, versionLabel: "m1" });
    const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const noOverflow = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.goto(`/developer/rulesets/${r.id}`);
    await noOverflow();
    for (const section of ["Manifests", "Canon Policy", "Conflicts", "Decisions", "ChangeSets", "Releases"]) {
      await page.getByRole("navigation", { name: "Ruleset sections" }).getByRole("link", { name: section, exact: true }).click();
      await expect(page.getByRole("link", { name: section, exact: true })).toHaveAttribute("aria-current", "page");
      await noOverflow();
    }
    for (const [url, heading] of [[`conflicts/${c.id}`, /Mobile conflict/], [`change-sets/${cs.id}`, /Mobile CS/], [`releases/${rel.id}`, /Release 1/]] as const) {
      await page.goto(`/developer/rulesets/${r.id}/${url}`);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      await noOverflow();
    }
    await context.close();
  });
});
