import { createHash, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

/**
 * PAS-10 M3-WO8 §79–§88 — the Import Studio through the REAL browser UI.
 *
 * Fixtures that have no UI by design are seeded BEFORE the browser starts through the guarded @prowess/db test
 * client against prowess_studio_test only (no production /seed route exists): a registered Source Snapshot with an
 * ingested structure (the Studio has no upload), Entities with aliases, and an ENTITY-candidate Batch seeded as a
 * committed extraction (no official extractor proposes Entities). Every review step happens in the browser.
 */
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/prowess_studio_test";

const STAMP = `${Date.now()}`;
const PREFIX = `test.m3ui${STAMP}`;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
type Db = typeof import("@prowess/db");
let db: Db;
const fx = { snapshotId: "", entityBatchId: "", documentId: "", e1: "", e2: "", e3: "" };

/**
 * Letters-only run tag woven into this spec's source text, so every Candidate label is unique to this run.
 * (Global table counts cannot prove "nothing materialized" here: CI runs other spec files in parallel workers, and
 * they legitimately create Entities, Versions, Keywords and RuleConflicts at the same time.)
 */
const TAG = `Zq${STAMP.slice(-7).replace(/\d/g, (d) => "abcdefghij"[Number(d)] as string)}`;

/**
 * §86: no domain / governance record derived from this run's import content exists anywhere — any materialization
 * of these Candidates would have to carry their unique labels. (Full-table byte-for-byte immutability is proven
 * serially by the API and DB integration suites.)
 */
async function materializedFromThisRun() {
  const p = db.prisma;
  const like = { contains: TAG };
  return {
    entities: await p.entity.count({ where: { canonicalKey: like } }),
    versions: await p.entityVersion.count({ where: { OR: [{ displayName: like }, { rulesText: like }] } }),
    keywords: await p.keywordDefinition.count({ where: { OR: [{ name: like }, { canonicalKey: like }] } }),
    aliases: await p.entityAlias.count({ where: { alias: like } }),
    ruleConflicts: await p.ruleConflict.count({ where: { OR: [{ title: like }, { description: like }] } }),
  };
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  db = await import("@prowess/db");
  db.assertRunningAgainstTestDatabase(process.env.DATABASE_URL as string);
  const doc = await db.createSourceDocument({ title: `Import UI Playtest ${STAMP}`, sourceType: "DOCUMENT" });
  fx.documentId = doc.id;
  const snapshot = await db.createSourceSnapshot(doc.id, { label: `Core Packet ${STAMP}`, originalFilename: "core.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", contentHash: sha(`ui${STAMP}`), byteSize: 2048, declaredVersion: "V0.1" });
  fx.snapshotId = snapshot.id;
  await db.ingestSourceStructure(snapshot.id, {
    parserName: "test-structure",
    parserVersion: "1",
    sections: [
      { key: "rules", parentKey: null, title: "Spellcasting", headingLevel: 1, ordinal: 0, pageLocationBasis: "UNAVAILABLE" },
      { key: "costs", parentKey: "rules", title: "Spell Costs", headingLevel: 2, ordinal: 1, pageLocationBasis: "UNAVAILABLE" },
    ],
    assets: [],
    nodes: [
      { ordinal: 0, sectionKey: "rules", nodeType: "BLOCK", block: { blockType: "HEADING", rawText: "Spellcasting", pageLocationBasis: "UNAVAILABLE" } },
      { ordinal: 1, sectionKey: "costs", nodeType: "BLOCK", block: { blockType: "HEADING", rawText: "Spell Costs", pageLocationBasis: "UNAVAILABLE" } },
      { ordinal: 2, sectionKey: "costs", nodeType: "BLOCK", block: { blockType: "PARAGRAPH", rawText: `Spell AP ${TAG} = floor(Final MP / PRO), minimum 1.`, pageLocationBasis: "UNAVAILABLE" } },
      { ordinal: 3, sectionKey: "costs", nodeType: "BLOCK", block: { blockType: "PARAGRAPH", rawText: `Keywords: Cost ${TAG}, Magic ${TAG}`, pageLocationBasis: "UNAVAILABLE" } },
      { ordinal: 4, sectionKey: "costs", nodeType: "TABLE", table: { pageLocationBasis: "UNAVAILABLE", structure: { schemaVersion: 1, rowCount: 2, columnCount: 2, rows: [
        { index: 0, isHeader: true, cells: [{ index: 0, columnIndex: 0, rowSpan: 1, colSpan: 1, isHeader: true, rawText: "Tier", nestedTables: [] }, { index: 1, columnIndex: 1, rowSpan: 1, colSpan: 1, isHeader: true, rawText: "MP", nestedTables: [] }] },
        { index: 1, isHeader: false, cells: [{ index: 0, columnIndex: 0, rowSpan: 1, colSpan: 1, isHeader: false, rawText: "Novice", nestedTables: [] }, { index: 1, columnIndex: 1, rowSpan: 1, colSpan: 1, isHeader: false, rawText: "3", nestedTables: [] }] },
      ] } } },
    ],
  });
  // Entities for matching: two share the alias "Arcane Focus <stamp>" (a POTENTIAL match with two suggestions), one is never suggested.
  const e1 = await db.createEntity({ entityType: "RESOURCE", canonicalKey: `${PREFIX}.arcane_focus_a` });
  const e2 = await db.createEntity({ entityType: "RESOURCE", canonicalKey: `${PREFIX}.arcane_focus_b` });
  const e3 = await db.createEntity({ entityType: "RESOURCE", canonicalKey: `${PREFIX}.unsuggested` });
  await db.createEntityAlias(e1.id, { alias: `Arcane Focus ${STAMP}` });
  await db.createEntityAlias(e2.id, { alias: `Arcane Focus ${STAMP}` });
  Object.assign(fx, { e1: e1.id, e2: e2.id, e3: e3.id });
  // An ENTITY-candidate Batch, seeded as a committed extraction (the WO3 commit shape).
  const { batch } = await db.createImportBatch({ sourceSnapshotId: snapshot.id, label: `Entity review ${STAMP}`, scope: { type: "SNAPSHOT" }, extractorKey: "prowess.test-entities", extractorVersion: "1" });
  fx.entityBatchId = batch.id;
  const sectionId = (await db.prisma.sourceSection.findFirst({ where: { sourceSnapshotId: snapshot.id, ordinal: 1 } }))!.id;
  const rows = [`Arcane Focus ${STAMP}`, `Mystery Term ${STAMP}`].map((label, i) => ({
    id: randomUUID(), importBatchId: batch.id, sourceSnapshotId: snapshot.id, ordinal: i + 1, candidateKind: "ENTITY" as const, proposedEntityType: "RESOURCE" as const, proposedCanonicalKey: null,
    displayLabel: label, confidence: "HIGH" as const, status: "UNREVIEWED" as const, payloadSchemaKey: "prowess.test.entity", payloadSchemaVersion: 1, payloadJson: { label },
    candidateFingerprint: sha(`${batch.id}:${i}`), primarySourceSectionId: sectionId,
  }));
  await db.prisma.extractionCandidate.createMany({ data: rows });
  const hash = sha(["PROWESS_EXTRACTION_SET_V1", ...rows.map((r) => `${r.ordinal}:${r.candidateFingerprint}`)].join("\n"));
  await db.prisma.importBatch.update({ where: { id: batch.id }, data: { status: "READY_FOR_REVIEW", extractionOutputHash: hash, extractedAt: new Date() } });
});

test.afterAll(async () => {
  const p = db.prisma;
  const snaps = [fx.snapshotId];
  const batches = (await p.importBatch.findMany({ where: { sourceSnapshotId: { in: snaps } }, select: { id: true } })).map((b) => b.id);
  const inBatch = { importBatchId: { in: batches } };
  await p.importDecision.deleteMany({ where: inBatch });
  await p.candidateDuplicateGroupMember.deleteMany({ where: inBatch });
  await p.candidateDuplicateGroup.deleteMany({ where: inBatch });
  await p.candidateMatchSuggestion.deleteMany({ where: { assessment: inBatch } });
  await p.candidateMatchAssessment.deleteMany({ where: inBatch });
  await p.importMatchRun.deleteMany({ where: inBatch });
  const inSnap = { sourceSnapshotId: { in: snaps } };
  await p.extractionCandidateSource.deleteMany({ where: inSnap });
  await p.extractionCandidate.deleteMany({ where: inSnap });
  await p.importBatch.deleteMany({ where: inSnap });
  await p.sourceContentNode.deleteMany({ where: inSnap });
  await p.sourceBlock.deleteMany({ where: inSnap });
  await p.sourceTable.deleteMany({ where: inSnap });
  for (const s of await p.sourceSection.findMany({ where: inSnap, select: { id: true }, orderBy: { ordinal: "desc" } })) await p.sourceSection.delete({ where: { id: s.id } });
  await p.sourceSnapshotIngestion.deleteMany({ where: inSnap });
  await p.sourceSnapshot.deleteMany({ where: { id: { in: snaps } } });
  await p.sourceDocument.deleteMany({ where: { id: fx.documentId } });
  await p.entityAlias.deleteMany({ where: { entity: { canonicalKey: { startsWith: PREFIX } } } });
  await p.entity.deleteMany({ where: { canonicalKey: { startsWith: PREFIX } } });
});

/** A queue row by its exact display label (section context text also appears in rows). */
const row = (page: Page, label: string) => page.getByTestId("queue-row").filter({ has: page.locator(".imp-queue__label", { hasText: new RegExp(`^${label}$`) }) });

async function record(page: Page, action: string) {
  await page.getByRole("button", { name: action, exact: true }).click();
  await page.getByRole("checkbox", { name: /Select the next Candidate/ }).uncheck();
  await page.getByRole("button", { name: `Record: ${action}` }).click();
  await expect(page.getByTestId("decision-status")).toContainText("Recorded:");
}

test("§79 Developer → Import landing", async ({ page }) => {
  await page.goto("/developer");
  await page.getByRole("link", { name: "Import Studio" }).click();
  await expect(page).toHaveURL(/\/developer\/import$/);
  await expect(page.getByRole("heading", { name: "Import Studio", level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Import" }).getByRole("link", { name: "Import Home" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "Browse Sources" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create Import Batch" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Registered Source Snapshots" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent Import Batches" })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(`Core Packet ${STAMP}`) })).toBeVisible();
});

test("§80 Source Inspector: outline, section selection, verbatim text, table", async ({ page }) => {
  await page.goto("/developer/import/sources");
  await expect(page.getByText("Document upload is not yet available in the Phase 1 Studio.")).toBeVisible();
  await page.getByRole("link", { name: `Core Packet ${STAMP}` }).click();
  await expect(page.getByTestId("ingestion-state")).toContainText("Structure ingested");
  const outline = page.getByRole("navigation", { name: "Source outline" });
  await expect(outline.getByRole("button", { name: /Spellcasting/ })).toBeVisible();
  await outline.getByRole("button", { name: /Spell Costs/ }).click();
  await expect(page.getByTestId("selected-section")).toHaveText("Spellcasting > Spell Costs");
  await expect(page.getByText(`Spell AP ${TAG} = floor(Final MP / PRO), minimum 1.`, { exact: true })).toBeVisible();
  await expect(page.getByTestId("source-table").getByRole("cell", { name: "Novice" })).toBeVisible();
});

test("§81 / §82 / §85 / §86 create, extract, semantic review, completion — nothing materialized", async ({ page }) => {
  const zero = { entities: 0, versions: 0, keywords: 0, aliases: 0, ruleConflicts: 0 };
  expect(await materializedFromThisRun()).toEqual(zero);
  await page.goto(`/developer/import/batches?snapshot=${fx.snapshotId}`);
  await page.getByRole("radio", { name: /Semantic Foundation/ }).check();
  await page.getByLabel("Label").fill(`Semantic ${STAMP}`);
  await page.getByRole("button", { name: "Create Batch" }).click();
  await expect(page).toHaveURL(/\/developer\/import\/batches\/[0-9a-f-]{36}/);
  await expect(page.getByTestId("batch-status")).toHaveText("Created");
  await page.getByRole("button", { name: "Run Extraction" }).click();
  await expect(page.getByTestId("batch-status")).toHaveText("Ready for Review");
  await expect(page.getByTestId("integrity-ok")).toContainText("Stored candidate set matches output hash");
  await expect(page.getByTestId("output-hash")).not.toHaveText("—");
  const rows = page.getByTestId("queue-row");
  await expect(rows).toHaveCount(3);

  await row(page, `Spell AP ${TAG}`).click();
  await expect(page.getByTestId("formula-view")).toContainText("floor(Final MP / PRO)");
  await expect(page.getByTestId("source-highlight")).toHaveText(`Spell AP ${TAG} = floor(Final MP / PRO), minimum 1`);
  await record(page, "Approve Semantic for Import");
  await expect(row(page, `Spell AP ${TAG}`).getByTestId("candidate-status")).toHaveText(/Approved for Import/);

  await row(page, `Cost ${TAG}`).click();
  await expect(page.getByTestId("keyword-view")).toContainText("does not grant mechanics");
  await record(page, "Approve Semantic for Import");
  await expect(page.getByTestId("complete-blocked")).toContainText("1 Candidate(s)"); // §85 cannot complete early
  await expect(page.getByRole("button", { name: "Complete Review" })).toBeDisabled();

  await row(page, `Magic ${TAG}`).click();
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await page.getByLabel("Rationale (required)").fill("Covered by the Magic glossary entry.");
  await page.getByRole("button", { name: "Record rejection" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm: Record rejection" }).click();
  await expect(row(page, `Magic ${TAG}`).getByTestId("candidate-status")).toHaveText(/Rejected/);
  await expect(page.getByTestId("decision-history").first()).toBeVisible();

  await page.getByRole("button", { name: "Complete Review" }).click();
  await expect(page.getByRole("dialog")).toContainText("It does not publish or create Canon content.");
  await page.getByRole("dialog").getByRole("button", { name: "Confirm: Complete Review" }).click();
  await expect(page.getByTestId("batch-status")).toHaveText("Review Complete");
  await expect(page.getByTestId("batch-workspace")).toHaveAttribute("data-read-only", "true");
  await rows.first().click();
  await expect(page.getByTestId("read-only-note")).toBeVisible();
  await expect(page.getByTestId("decision-panel")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^(Approve|Reject|Classify|Record|Run Extraction|Analyze)/ })).toHaveCount(0);
  await expect(page.getByRole("tabpanel", { name: "History" }).getByTestId("decision-entry")).toHaveCount(4); // 1 candidate history + 3 batch entries
  expect(await materializedFromThisRun()).toEqual(zero); // §86 nothing materialized from this run's Candidates
});

test("§83 / §84 match review: explicit run, no automatic selection, suggested and manual classification", async ({ page }) => {
  await page.goto(`/developer/import/batches/${fx.entityBatchId}`);
  await expect(page.getByText("No MatchRuns yet. Matching never runs automatically.")).toBeVisible();
  await page.getByRole("button", { name: "Analyze Entity Matches" }).click();
  await expect(page).toHaveURL(/matchRun=[0-9a-f-]{36}/);
  await row(page, `Arcane Focus ${STAMP}`).click();
  await expect(page.getByTestId("match-outcome")).toHaveText("Potential Match (not accepted)");
  await expect(page.getByTestId("match-suggestion")).toHaveCount(2);

  await page.getByRole("button", { name: "Classify as Matched", exact: true }).click();
  await page.getByLabel("Match basis").selectOption("SUGGESTED_MATCH");
  const choices = page.getByRole("radio");
  await expect(choices).toHaveCount(2);
  for (const c of await choices.all()) await expect(c).not.toBeChecked(); // nothing preselected
  await choices.nth(1).check();
  await page.getByRole("checkbox", { name: /Select the next Candidate/ }).uncheck();
  await page.getByRole("button", { name: "Record: Classify as Matched" }).click();
  await expect(page.getByTestId("decision-status")).toContainText("now Matched");
  await record(page, "Approve Matched for Import");
  await expect(page.getByTestId("candidate-detail").getByTestId("candidate-status")).toHaveText(/Approved for Import/);
  await expect(page.getByRole("region", { name: "Candidate decision history" }).getByTestId("decision-entry")).toHaveCount(2);

  await row(page, `Mystery Term ${STAMP}`).click();
  await page.getByRole("button", { name: "Classify as Matched", exact: true }).click();
  await page.getByLabel("Match basis").selectOption("MANUAL_OVERRIDE");
  await page.getByRole("button", { name: "Record: Classify as Matched" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "A rationale is required for a manual override." })).toBeVisible();
  await page.getByLabel("Target Entity", { exact: true }).fill(`${PREFIX}.unsuggested`);
  await page.getByRole("button", { name: new RegExp(`${PREFIX}.unsuggested`) }).click();
  await page.getByLabel("Rationale (required)").fill("Designer confirmed this term is the unsuggested resource.");
  await page.getByRole("button", { name: "Record: Classify as Matched" }).click();
  await expect(page.getByTestId("decision-status")).toContainText("now Matched");
});

test("§87 / §88 mobile: tabbed queue, details, source evidence and history, no horizontal layout dependency", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL });
  const page = await context.newPage();
  await page.goto(`/developer/import/batches/${fx.entityBatchId}`);
  const tabs = page.getByRole("tablist", { name: "Workspace panes" });
  await expect(tabs).toBeVisible();
  await expect(tabs.getByRole("tab", { name: "Queue" })).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("queue-row").first().click();
  await expect(tabs.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("candidate-detail")).toBeVisible();
  await expect(page.getByTestId("decision-panel")).toBeVisible();
  await tabs.getByRole("tab", { name: "Source" }).click();
  await expect(page.getByTestId("source-evidence")).toBeVisible();
  await tabs.getByRole("tab", { name: "History" }).click();
  await expect(page.getByRole("tabpanel", { name: "History" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  // §88 keyboard: tabs and queue rows are focusable buttons with accessible names; status is text, not color.
  await tabs.getByRole("tab", { name: "Queue" }).focus();
  await page.keyboard.press("Enter");
  await expect(tabs.getByRole("tab", { name: "Queue" })).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("queue-row").first().focus();
  await expect(page.getByTestId("queue-row").first()).toBeFocused();
  await expect(page.getByTestId("queue-row").first().getByTestId("candidate-status")).toHaveText(/\w/);
  await context.close();
});
