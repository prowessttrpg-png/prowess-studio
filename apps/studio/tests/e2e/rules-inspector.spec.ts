import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/prowess_studio_test";
let sequence = 0;
type Id = { id: string };
async function post<T>(request: APIRequestContext, path: string, data?: unknown): Promise<T> {
  const response = await request.post(path, { data });
  expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
  return (await response.json()).data as T;
}
async function fixture(request: APIRequestContext) {
  const key = `test.m4ui.${Date.now()}.${++sequence}`;
  const ruleset = await post<Id>(request, "/api/rulesets", { canonicalKey: key, name: key, channel: "CORE_PLAYTEST" });
  await post(request, `/api/rulesets/${ruleset.id}/submit-review`); await post(request, `/api/rulesets/${ruleset.id}/approve`);
  const manifest = await post<Id>(request, `/api/rulesets/${ruleset.id}/manifests`, { entries: [] });
  const policy = await post<Id>(request, `/api/rulesets/${ruleset.id}/canon-policies`, { name: "Lab policy", authorities: [] });
  const release = await post<Id & { manifestId: string; releaseNumber: number }>(request, `/api/rulesets/${ruleset.id}/releases`, { baseManifestId: manifest.id, canonPolicyId: policy.id, versionLabel: "lab-r1" });
  return { ruleset, manifest, release, policy };
}
async function choose(page: Page, rulesetId: string, id: string, mode: "Manifest" | "Release" = "Manifest") {
  await page.goto("/developer/rules");
  if (mode === "Release") await page.getByRole("button", { name: "Release", exact: true }).click();
  const selector = page.getByLabel("Ruleset", { exact: true });
  await expect.poll(() => selector.locator("option").count()).toBeGreaterThan(1);
  while (await selector.locator(`option[value="${rulesetId}"]`).count() === 0) {
    const count = await selector.locator("option").count();
    await page.getByRole("button", { name: "Load more Rulesets" }).click();
    await expect.poll(() => selector.locator("option").count()).toBeGreaterThan(count);
  }
  await selector.selectOption(rulesetId);
  await expect(page.getByLabel(`Exact ${mode}`, { exact: true })).toBeEnabled();
  await page.getByLabel(`Exact ${mode}`, { exact: true }).selectOption(id);
}
async function author(page: Page, plan: unknown) {
  await page.getByText("Import plan JSON", { exact: true }).click();
  await page.getByLabel("Plan JSON", { exact: true }).fill(JSON.stringify(plan));
  await page.getByRole("button", { name: "Use plan JSON" }).click();
}
async function run(page: Page) {
  await page.getByRole("button", { name: "Run Evaluation", exact: true }).click();
  await expect(page.getByRole("list", { name: "Executed step timeline" })).toBeVisible();
}
async function inspect(page: Page, key: string, operation: string) {
  await page.getByRole("list", { name: "Executed step timeline" }).getByRole("button", { name: new RegExp(`${key} · ${operation}`) }).click();
}
async function fingerprint(rulesetId: string) {
  const { prisma, assertRunningAgainstTestDatabase } = await import("@prowess/db");
  assertRunningAgainstTestDatabase(process.env.DATABASE_URL!);
  // Scoped rows: other spec files create their own fixtures concurrently. API integration fingerprints all tables serially.
  return JSON.stringify({ ruleset: await prisma.ruleset.findUnique({ where: { id: rulesetId } }), manifests: await prisma.rulesetManifest.findMany({ where: { rulesetId }, orderBy: { id: "asc" }, include: { entries: true } }), releases: await prisma.rulesetRelease.findMany({ where: { rulesetId }, orderBy: { id: "asc" } }), policies: await prisma.canonPolicy.findMany({ where: { rulesetId }, orderBy: { id: "asc" } }) });
}

test.describe("M4-WO11 Rules Inspector — real HTTP and exact Rulesets", () => {
  test("full neutral flow, projection, provenance, stale inputs and read-only evaluation", async ({ page, request }) => {
    const { ruleset, release } = await fixture(request);
    await choose(page, ruleset.id, release.id, "Release");
    await page.getByRole("button", { name: "Load neutral sample" }).click();
    const before = await fingerprint(ruleset.id);
    const writes: string[] = [];
    page.on("request", req => { if (req.method() !== "GET") writes.push(new URL(req.url()).pathname); });
    await run(page);
    await expect(page.getByText("COMPLETE", { exact: true }).last()).toBeVisible();
    await inspect(page, "payment", "RESOURCE_PAYMENT_APPLY");
    await expect(page.getByTestId("listed-value")).toContainText("17");
    await expect(page.getByTestId("payment-allocation")).toContainText("r.temp66");
    await expect(page.getByTestId("payment-allocation")).toContainText("r.primary20119");
    await expect(page.getByTestId("resulting-resources")).toContainText("r.primary9");
    await inspect(page, "derived", "FORMULA"); await expect(page.getByTestId("overview-derived")).toContainText("4.25");
    await expect(page.getByTestId("overview-derived")).toContainText("Final Result4");
    await page.getByLabel("Returned explanation step").selectOption("summary");
    await expect(page.getByRole("region", { name: "SUMMARY explanation" })).toBeVisible();
    await expect(page.getByTestId("explanation-payment")).toContainText("17");
    await page.getByRole("button", { name: /^Trace derived \/ / }).first().click();
    await expect(page.getByRole("tab", { name: "TRACE", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('[data-focused="true"]')).toBeVisible();
    await page.getByRole("tab", { name: "PROVENANCE", exact: true }).click();
    await expect(page.getByRole("region", { name: "Selected step inspector" })).toContainText(release.id);
    await page.getByText("ACTOR · Enabled", { exact: true }).click();
    await page.getByLabel("actor JSON").fill('{"stats":{"divisor":8}}');
    await expect(page.getByText(/STALE — Inputs changed/)).toBeVisible();
    expect(writes).toEqual(["/api/rules/evaluate"]); expect(await fingerprint(ruleset.id)).toBe(before);
  });
  test("false Requirement, unavailable payment, reservation and exact validation severities", async ({ page, request }) => {
    const { ruleset, manifest } = await fixture(request); await choose(page, ruleset.id, manifest.id);
    const resources = { resources: [{ resourceKey: "r.a", kind: "POOL", current: 6, minimum: 0, maximum: 20, reservedCapacity: 0 }, { resourceKey: "r.b", kind: "POOL", current: 2, minimum: 0, maximum: 20, reservedCapacity: 0 }] };
    await author(page, { validationStepKey: "validation", steps: [
      { stepKey: "requirement", order: 1, operation: "REQUIREMENT", input: { requirement: { kind: "ENTITY_OWNED", entityId: "40000000-0000-4000-8000-000000000001" }, facts: { ownedEntityIds: [] } } },
      { stepKey: "payment", order: 2, operation: "RESOURCE_PAYMENT_APPLY", input: { snapshot: resources, payment: { costKey: "x", listedAmount: 10, sources: [{ resourceKey: "r.a", order: 1 }, { resourceKey: "r.b", order: 2 }] } } },
      { stepKey: "reserve", order: 3, operation: "RESOURCE_RESERVE_CAPACITY", input: { snapshot: { resources: [{ resourceKey: "r.c", kind: "POOL", current: 18, minimum: 0, maximum: 20, reservedCapacity: 0 }] }, request: { resourceKey: "r.c", amount: 6 } } },
      { stepKey: "validation", order: 4, operation: "VALIDATION", input: { request: { checks: ["ERROR", "WARNING", "INFO"].map((severity, order) => ({ checkKey: `check.${order}`, order, outcome: "FAIL", failureSeverity: severity, category: "STRUCTURE", code: `LAB.${severity}`, message: `Lab ${severity}`, path: `/lab/${order}` })) } } },
    ] });
    await run(page); await inspect(page, "requirement", "REQUIREMENT"); await expect(page.getByRole("heading", { name: "NOT SATISFIED", exact: true })).toBeVisible();
    await inspect(page, "payment", "RESOURCE_PAYMENT_APPLY"); await expect(page.getByText("Payment unavailable — State unchanged")).toBeVisible(); await expect(page.getByText("Shortfall 2")).toBeVisible();
    await expect(page.getByTestId("resulting-resources")).toContainText("r.a6r.b2");
    await inspect(page, "reserve", "RESOURCE_RESERVE_CAPACITY"); await expect(page.getByRole("heading", { name: "Capacity Reserved" })).toBeVisible();
    for (const severity of ["ERROR", "WARNING", "INFO"]) await expect(page.getByRole("region", { name: "Evaluation result" })).toContainText(`LAB.${severity}`);
    await expect(page.getByRole("heading", { name: /Request Error/ })).toHaveCount(0);
  });
  test("PARTIAL shows invalid child, blocked dependency and independent work", async ({ page, request }) => {
    const { ruleset, manifest } = await fixture(request); await choose(page, ruleset.id, manifest.id);
    await author(page, { steps: [
      { stepKey: "a", order: 1, operation: "FORMULA", input: { program: { expression: "1 / 0" }, variables: {} } },
      { stepKey: "b", order: 2, operation: "MODIFIER", input: { request: {} }, bindings: [{ target: "/request", source: { kind: "STEP", stepKey: "a", pointer: "/data/missing" } }] },
      { stepKey: "c", order: 3, operation: "REQUIREMENT", input: { requirement: { kind: "ENTITY_OWNED", entityId: "40000000-0000-4000-8000-000000000001" }, facts: { ownedEntityIds: [] } } },
      { stepKey: "d", order: 4, operation: "EXPLANATION", input: { input: { explanationKey: "partial", contributions: [{ contributionKey: "a", order: 1, kind: "FORMULA", response: null }, { contributionKey: "c", order: 2, kind: "REQUIREMENT", response: null }] } }, bindings: [{ target: "/input/contributions/0/response", source: { kind: "STEP", stepKey: "a", pointer: "" } }, { target: "/input/contributions/1/response", source: { kind: "STEP", stepKey: "c", pointer: "" } }] },
    ] });
    await run(page); await expect(page.getByRole("region", { name: "Evaluation result" })).toContainText("PARTIAL");
    await expect(page.getByRole("list", { name: "Executed step timeline" })).toContainText("b · MODIFIER · BLOCKED");
    await expect(page.getByRole("list", { name: "Executed step timeline" })).toContainText("d · EXPLANATION · EXECUTED / SUCCESS");
    await inspect(page, "a", "FORMULA"); await expect(page.getByTestId("overview-a")).toContainText("INVALID");
  });
  test("old Release remains exact after a newer publication", async ({ page, request }) => {
    const { ruleset, release, policy } = await fixture(request); await choose(page, ruleset.id, release.id, "Release");
    await page.getByRole("button", { name: "Load neutral sample" }).click(); await run(page);
    const first = await page.getByRole("region", { name: "DETAILED explanation" }).textContent();
    const later = await post<Id & { releaseNumber: number }>(request, `/api/rulesets/${ruleset.id}/releases`, { baseManifestId: release.manifestId, canonPolicyId: policy.id, versionLabel: "lab-r2" });
    expect(later.releaseNumber).toBe(2); expect(later.id).not.toBe(release.id);
    await run(page); expect(await page.getByRole("region", { name: "DETAILED explanation" }).textContent()).toBe(first);
    await expect(page.getByLabel("Exact Release", { exact: true })).toHaveValue(release.id);
  });
  test("mobile panes retain controls and contain long JSON without page overflow", async ({ page, request }) => {
    const { ruleset, manifest } = await fixture(request); await page.setViewportSize({ width: 390, height: 844 }); await choose(page, ruleset.id, manifest.id);
    await page.getByRole("button", { name: "Load neutral sample" }).click(); await run(page);
    await expect(page.getByRole("tab", { name: "RUN", exact: true })).toHaveAttribute("aria-selected", "true");
    await inspect(page, "payment", "RESOURCE_PAYMENT_APPLY"); await expect(page.getByRole("tab", { name: "DETAILS", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "RAW", exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("tab", { name: "PLAN", exact: true }).click(); await expect(page.getByRole("button", { name: "Run Evaluation" })).toBeVisible();
  });
});
