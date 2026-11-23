import { expect as baseExpect, test, type APIRequestContext, type Page } from "@playwright/test";
import "./m6-wo8-fixture-loader";
import "./m6-wo11-fixture-loader";
import { post, type Id } from "./m6-wo5-world";

/**
 * RULES-WO1 Phase H — Maneuver authoring proofs on the real backend (an isolated WO12 test world; nothing here is canon).
 *
 *   P14 Maneuver Radius: open the published "Maneuver Radius" (Martial Rank Base × STR, 5 / 10 / 15 ft), create a new
 *       revision, see the rank table and "rank base × STR" as readable controls, DELIBERATELY change Expert 10 → 12 in this
 *       isolated world, preview it (Expert, STR 4 → 48 ft; Master → 60 ft), save and reopen, publish it in a test Release
 *       and show that a Character built on the earlier Release is unchanged.
 *   P15 Maneuver proof: author a Maneuver Condition, publish it, and build a valid Maneuver with it through the real
 *       Maneuver builder — the server evaluates the Attack's targeting, the cost (the Condition takes 1 AP off) and the
 *       Condition's play-time restriction (recorded, deferred to the play runtime).
 */
const expect = baseExpect.configure({ timeout: 30_000 });
test.describe.configure({ mode: "serial" });
type Db = typeof import("@prowess/db");
type Pin = { entityId: string; entityVersionId: string; canonicalKey: string };
type World = { rulesetId: string; policyId: string; release: { id: string; manifestId: string; releaseNumber: number }; pins: Map<string, Pin> };
type Prep = { preparePlaytestRelease: (runId: string) => Promise<{ summary: { runId: string }; world: World }>; cleanupPlaytestWorlds: (runId: string) => Promise<unknown> };
type Fixtures = { martialCharacter: (w: World, name: string, master?: boolean) => Promise<{ character: { id: string } }> };
const runtimeImport = (specifier: string): Promise<unknown> => import(specifier);

let db: Db;
let prep: Prep;
let fixtures: Fixtures;
let world: World;
let latest: { id: string; manifestId: string };
const runId = `rw1h${Date.now().toString(36)}`;

test.beforeAll(async () => {
  test.setTimeout(600_000);
  db = await import("@prowess/db");
  db.assertRunningAgainstTestDatabase(process.env.DATABASE_URL as string);
  prep = (await runtimeImport("../../../../packages/prowess-db/tests/fixtures/m6-wo12-playtest")) as Prep;
  fixtures = (await runtimeImport("../../../../packages/prowess-db/tests/fixtures/m6-wo8-maneuvers")) as Fixtures;
  world = (await prep.preparePlaytestRelease(runId)).world;
  latest = { id: world.release.id, manifestId: world.release.manifestId };
});
test.afterAll(async () => {
  test.setTimeout(300_000);
  if (prep !== undefined && process.env.PROWESS_RW1H_KEEP_WORLD !== "1") await prep.cleanupPlaytestWorlds(runId);
});

async function approve(request: APIRequestContext, versionId: string) {
  await post(request, `/api/entity-versions/${versionId}/status`, { status: "IN_REVIEW" });
  await post(request, `/api/entity-versions/${versionId}/status`, { status: "APPROVED" });
}
async function release(request: APIRequestContext, name: string, operations: unknown[]) {
  const cs = await post<Id>(request, `/api/rulesets/${world.rulesetId}/change-sets`, { name, operations });
  await post(request, `/api/change-sets/${cs.id}/submit-review`);
  await post(request, `/api/change-sets/${cs.id}/approve`);
  const r = await post<Id & { manifestId: string; releaseNumber: number }>(request, `/api/rulesets/${world.rulesetId}/releases`, { baseManifestId: latest.manifestId, canonPolicyId: world.policyId, changeSetId: cs.id, versionLabel: `0.${Date.now() % 100000}.0` });
  latest = { id: r.id, manifestId: r.manifestId };
  return r;
}
async function preview(page: Page, rank: string, str: number) {
  const panel = page.getByTestId("reference-preview");
  await panel.getByLabel("Sample rank for MARTIAL_RANK_BASE").selectOption(rank);
  await panel.getByLabel("Sample STR").fill(String(str));
  await panel.getByTestId("reference-preview-run").click();
  return panel.getByTestId("preview-measure-RADIUS");
}

test("RULES-WO1 P14 Maneuver Radius: the Martial-rank table and rank base × STR are edited, previewed, saved, reopened and published; earlier Characters are unchanged", async ({ page, request }) => {
  test.setTimeout(480_000);
  const radius = world.pins.get("maneuver.targeting.radius")!;
  // A Character on the earlier Release (R1), recorded before anything changes.
  const before = await fixtures.martialCharacter(world as never, `Before Radius ${runId}`);
  const sheetBefore = JSON.stringify(await db.getCharacterSheet(before.character.id));

  // A new revision of the published Radius, from its Entity page.
  await page.goto(`/compendium/admin/entities/${radius.entityId}`);
  await page.getByLabel("Change summary (why this revision exists)").fill("Isolated test: Expert base 12 ft.");
  await page.getByRole("button", { name: "Create New Revision from Revision 1" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /— Revision 2$/ })).toBeVisible();
  const draftUrl = page.url();
  const versionId = /revisions\/([^/?]+)/.exec(draftUrl)![1]!;

  // The published table and calculation, as readable controls (no expression, key or data editor).
  const t = page.getByTestId("targeting-mechanics");
  await expect(t.getByTestId("targeting-rank-table-0-name")).toHaveValue("Martial rank base");
  for (const [j, v] of [[0, "5"], [1, "10"], [2, "15"]] as const) await expect(t.getByTestId(`targeting-rank-table-0-row-${j}-value`)).toHaveValue(v);
  const distance = t.getByTestId("targeting-measure-RADIUS-distance");
  await expect(distance.getByRole("combobox", { name: "Contribution 1 input" })).toHaveValue("rank_base");
  await expect(distance.getByRole("combobox", { name: "Contribution 1 second input" })).toHaveValue("str");
  await expect(distance.getByTestId("formula-guided-unavailable")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Add field/i })).toHaveCount(0);

  // Deliberate change in this isolated world: Expert 10 → 12. Save.
  await t.getByTestId("targeting-rank-table-0-row-1-value").fill("12");
  await page.getByLabel(/^Change summary/).fill("Isolated test: Expert base 12 ft.");
  await page.getByRole("button", { name: "Save Draft" }).click();
  await expect(page.getByText("Draft saved — validation PASS.")).toBeVisible();
  const stored = (await (await request.get(`/api/entity-versions/${versionId}`)).json()).data.structuredData.prowessDefinition.payload;
  expect(stored.rules.targeting.rankTables[0].entries).toEqual([{ rankKey: "TRAINED", value: 5 }, { rankKey: "EXPERT", value: 12 }, { rankKey: "MASTER", value: 15 }]);
  expect(stored.rules.targeting.measures[0].formula).toEqual({ expression: "rank_base * str", rounding: "NONE", unit: "ft", variables: [{ variable: "rank_base", source: { kind: "SKILL_RANK_TABLE", table: "MARTIAL_RANK_BASE" } }, { variable: "str", source: { kind: "STAT", stat: "STR" } }] });

  // Preview the saved Draft: the same Formula and table the builders bind.
  await expect(page.getByTestId("reference-same-as-builders")).toBeVisible();
  await expect(await preview(page, "EXPERT", 4)).toHaveText("48 ft");
  await expect(await preview(page, "MASTER", 4)).toHaveText("60 ft");
  await expect(await preview(page, "TRAINED", 3)).toHaveText("15 ft");

  // Reopen: the saved value is there.
  await page.goto(draftUrl);
  await expect(page.getByTestId("targeting-mechanics").getByTestId("targeting-rank-table-0-row-1-value")).toHaveValue("12");

  // Publish it in a test Release (R2).
  await approve(request, versionId);
  const r2 = await release(request, `Radius ${runId}`, [{ operationType: "REPLACE_ENTITY_VERSION", targetEntityId: radius.entityId, fromEntityVersionId: radius.entityVersionId, toEntityVersionId: versionId }]);
  expect(r2.id).not.toBe(world.release.id);
  const published = await db.prisma.entityVersion.findUniqueOrThrow({ where: { id: radius.entityVersionId }, select: { status: true, structuredData: true } });
  expect(JSON.stringify(published.structuredData)).toContain('"value":10');

  // The earlier Character is unchanged: same Release, same sheet.
  const after = await db.getCharacterSheet(before.character.id);
  expect(JSON.stringify(after)).toBe(sheetBefore);
  const row = await db.prisma.character.findUniqueOrThrow({ where: { id: before.character.id }, select: { rulesetReleaseId: true } });
  expect(row.rulesetReleaseId).toBe(world.release.id);
});

test("RULES-WO1 P15 a newly authored Maneuver Condition is published and built into a valid Maneuver (targeting, cost, restriction by the evaluator)", async ({ page, request }) => {
  test.setTimeout(480_000);
  const name = `Planted Stance E2E ${runId}`;
  await page.goto("/compendium/admin/new");
  await page.getByLabel("Definition family").selectOption("MANEUVER");
  await page.getByLabel("Definition kind").selectOption("MANEUVER_CONDITION");
  await page.getByLabel("Display Name (required)").fill(name);
  await page.getByRole("button", { name: "Suggest a Canonical Key from the Display Name" }).click();
  const k = page.getByTestId("condition-mechanics");
  await k.getByTestId("condition-restriction").fill("Planted stance");
  await k.getByTestId("condition-applicability-0-fact").selectOption("mechanic.attack");
  await k.getByTestId("condition-runtime-add").click();
  await k.getByTestId("condition-runtime-0-name").fill("Feet planted");
  await k.getByTestId("condition-runtime-0-fact").fill("stays planted");
  await k.getByTestId("condition-cost-add").click();
  await k.getByTestId("condition-cost-0-meaning").selectOption("AP_REDUCTION");
  await k.getByTestId("condition-cost-0-amount").fill("1");
  await page.getByRole("button", { name: "Validate Definition" }).click();
  await expect(page.getByRole("region", { name: "Validation" }).getByRole("status")).toContainText("PASS");
  await page.getByRole("button", { name: "Create Definition as Draft" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `${name} — Revision 1` })).toBeVisible();
  const [, entityId, versionId] = /entities\/([^/]+)\/revisions\/([^/?]+)/.exec(page.url())!;
  await approve(request, versionId!);
  const r = await release(request, `Planted Stance ${runId}`, [{ operationType: "ADD_ENTITY_TO_MANIFEST", targetEntityId: entityId, toEntityVersionId: versionId }]);

  // A Character on that Release builds a Maneuver with the exact equipped Attack, an Effect and the new Condition.
  const built = await fixtures.martialCharacter({ ...world, release: { id: r.id, manifestId: r.manifestId, releaseNumber: r.releaseNumber } } as never, `Planted ${runId}`);
  const id = built.character.id;
  await page.goto(`/characters/${id}/maneuvers/new`);
  await page.getByLabel("Maneuver name").fill("Rooted Cut");
  await page.getByRole("button", { name: "Start building" }).click();
  await page.getByRole("tab", { name: "Action Selection" }).click();
  await page.getByRole("button", { name: "Add Long Blade · Long Blade — Slash · slashing", exact: true }).click();
  await page.getByRole("tab", { name: "Effects", exact: true }).click();
  await page.getByRole("button", { name: "Select test.wo8.effect.enhancement", exact: true }).click();
  await page.getByLabel(/^Attach .* to$/).first().selectOption("action1");
  await page.getByRole("tab", { name: "Duration", exact: true }).click();
  await page.getByRole("button", { name: "Select maneuver.duration.instant", exact: true }).click();
  await page.getByRole("button", { name: "Save now" }).click();
  await page.getByRole("tab", { name: "Review", exact: true }).click();
  const inspector = page.getByTestId("maneuver-cost-inspector");
  await expect(inspector).toContainText("Final listed AP / MP");
  const costOf = async () => Number((await inspector.innerText()).match(/Final listed AP \/ MP\s+(\d+) AP/)![1]);
  const withoutCondition = await costOf();

  await page.getByRole("tab", { name: "Conditions", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(`^Select (${name}|.*planted_stance.*)$`, "i") }).click();
  await page.getByRole("button", { name: "Save now" }).click();
  await page.getByRole("tab", { name: "Review", exact: true }).click();
  await expect(inspector).toContainText("Final listed AP / MP");
  await expect.poll(costOf).toBe(withoutCondition - 1);

  // The server's evaluation: valid, the Attack's own targeting, the Condition's restriction recorded for play.
  const maneuvers = (await (await request.get(`/api/characters/${id}/abilities`)).json()).data.maneuvers as Array<{ draft: { evaluation: Record<string, any> } }>;  
  const evaluation = maneuvers[0]!.draft.evaluation;
  expect(["VALID", "VALID_WITH_RUNTIME_DEFERRED"]).toContain(evaluation.state);
  expect(JSON.stringify(evaluation)).toMatch(/targeting/i);
  expect(JSON.stringify(evaluation)).toContain("runtime.staysPlanted");
  await page.getByRole("tab", { name: "Finalize", exact: true }).click();
  await page.getByRole("button", { name: "Finalize Maneuver", exact: true }).click();
  await expect(page.getByTestId("maneuver-detail")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("maneuver-history-revision")).toContainText("Revision 1 (current)");
});

/**
 *   P16 Cone Attack Conversion correction, as a Draft only: from the published revision (its formula reads
 *       `martial_rank`, which the Effect reader refuses), create a new revision through the normal revision service,
 *       replace the input with the Martial Rank Value in the guided editor and save it. Only that formula changes; the
 *       published revision and the Release are untouched, and nothing is published.
 */
test("RULES-WO1 P16 the Cone Attack Conversion correction is created as a Draft through the normal revision service and is not published", async ({ page, request }) => {
  test.setTimeout(300_000);
  const cone = world.pins.get("maneuver.effect.cone_attack_conversion")!;
  const source = await db.prisma.entityVersion.findUniqueOrThrow({ where: { id: cone.entityVersionId }, select: { status: true, revisionNumber: true, structuredData: true } });
  const publishedPayload = (source.structuredData as { prowessDefinition: { payload: Record<string, any> } }).prowessDefinition.payload;  
  expect(publishedPayload.rules.effect.formulas).toEqual([{ formulaKey: "length", expression: "5 * martial_rank", rounding: "NONE", minimum: 5, unit: "ft", variables: [{ variable: "martial_rank", source: { kind: "MARTIAL_RANK_VALUE" } }] }]);
  const pinnedBefore = await db.prisma.rulesetManifestEntry.findMany({ where: { entityId: cone.entityId }, select: { manifestId: true, entityVersionId: true } });

  await page.goto(`/compendium/admin/entities/${cone.entityId}`);
  await page.getByLabel("Change summary (why this revision exists)").fill("Representation-only correction: the formula input is named as the Effect reader requires.");
  await page.getByRole("button", { name: `Create New Revision from Revision ${source.revisionNumber}` }).click();
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(`— Revision ${source.revisionNumber + 1}$`) })).toBeVisible();
  const versionId = /revisions\/([^/?]+)/.exec(page.url())![1]!;
  const value = page.getByTestId("effect-formula-0");
  await expect(value.getByTestId("effect-formula-0-name")).toHaveValue("Length");
  await value.getByRole("button", { name: "Replace input martial_rank" }).click();
  await value.getByLabel("Replace input martial_rank: source").selectOption("MARTIAL_RANK_VALUE");
  await value.getByRole("button", { name: "Apply" }).click();
  await expect(value.getByTestId("formula-expression")).toHaveText("5 * martialRankValue");
  await page.getByLabel(/^Change summary/).fill("Representation-only correction: the formula input is named as the Effect reader requires.");
  await page.getByRole("button", { name: "Save Draft" }).click();
  await expect(page.getByText("Draft saved — validation PASS.")).toBeVisible();

  const draft = await db.prisma.entityVersion.findUniqueOrThrow({ where: { id: versionId }, select: { status: true, structuredData: true } });
  const corrected = (draft.structuredData as { prowessDefinition: { payload: Record<string, any> } }).prowessDefinition.payload;  
  expect(draft.status).toBe("DRAFT");
  expect(corrected.rules.effect.formulas).toEqual([{ formulaKey: "length", expression: "5 * martialRankValue", rounding: "NONE", minimum: 5, unit: "ft", variables: [{ variable: "martialRankValue", source: { kind: "MARTIAL_RANK_VALUE" } }] }]);
  const strip = (p: Record<string, any>) => ({ ...p, rules: { ...p.rules, effect: { ...p.rules.effect, formulas: null } } });  
  expect(strip(corrected)).toEqual(strip(publishedPayload));
  // The published revision and every Release pin are untouched; the correction is in no manifest.
  const after = await db.prisma.entityVersion.findUniqueOrThrow({ where: { id: cone.entityVersionId }, select: { status: true, structuredData: true } });
  expect(after).toEqual({ status: source.status, structuredData: source.structuredData });
  expect(await db.prisma.rulesetManifestEntry.findMany({ where: { entityId: cone.entityId }, select: { manifestId: true, entityVersionId: true } })).toEqual(pinnedBefore);
  expect(await db.prisma.rulesetManifestEntry.count({ where: { entityVersionId: versionId } })).toBe(0);
});
