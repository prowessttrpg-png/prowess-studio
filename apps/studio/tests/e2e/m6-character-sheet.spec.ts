import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { PORTRAIT_JPEG_30x40, PORTRAIT_PNG_96x64 } from "../fixtures/m6-wo5-portraits";
import { completedCharacter, post, seed, type Id, type World } from "./m6-wo5-world";

/**
 * PAS-10 M6-WO5 §115–§118, §114 — the Digital Character Sheet through the REAL Studio UI, against a capable Release
 * published through the existing API (test-only content; tests/e2e/m6-wo5-world.ts).
 *
 * 1. Sheet: server-derived values shown exactly; HP / MP / AP / Counter edited inline; Action Notes, Character Notes and
 *    Company / PAC autosave; a reload shows every mutable value persisted.
 * 2. Portrait: upload → zoom → drag → save → reload keeps the framing → replace → remove.
 * 3. An advanced (Level 6) Character's sheet: Level, Character Die, advanced Skills and Affinity — no stale Level 1 view.
 * 4. A newer Release (a revised Range Formula) leaves the existing Character's sheet on its own Release.
 * 5. Print: two Letter pages, no controls, sections on their pages, no third page for a normal Character.
 */
test.describe.configure({ mode: "serial" });
let world: World;
test.beforeAll(async ({ playwright, baseURL }) => {
  test.setTimeout(240_000);
  const request = await playwright.request.newContext({ baseURL });
  world = await seed(request);
  await request.dispose();
});

type SheetJson = {
  identity: { level: number };
  mechanics: { stats: Array<{ stat: string; total: number; savingThrow: { value: number } }>; combat: Record<string, { value: number | null; unit?: string | null } | { faces: number }> };
  resources: Array<{ resourceKey: string; maximum: number; current: number }>;
};
async function sheetJson(request: APIRequestContext, id: string): Promise<SheetJson> {
  const r = await request.get(`/api/characters/${id}/sheet`);
  expect(r.ok()).toBe(true);
  return (await r.json()).data as SheetJson;
}
const max = (s: SheetJson, k: string) => s.resources.find((r) => r.resourceKey === k)?.maximum as number;
const sel = (w: World, k: string) => ({ entityId: w.pins.get(k)!.entityId, entityVersionId: w.pins.get(k)!.entityVersionId });
async function openSheet(page: Page, id: string) {
  await page.goto(`/characters/${id}`);
  await expect(page.getByRole("tab", { name: "Sheet" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("sheet-page-1")).toBeVisible();
}
let notesCharacter = "";

test("a player reads server values and updates resources and notes inline; a reload keeps everything", async ({ page, request }) => {
  test.setTimeout(180_000);
  const c = await completedCharacter(request, world, `Sheet ${world.tag}`);
  notesCharacter = c.id;
  const s = await sheetJson(request, c.id);
  await openSheet(page, c.id);
  await expect(page.getByTestId("sheet-name")).toHaveText(`Sheet ${world.tag}`);
  await expect(page.getByTestId("sheet-level")).toHaveText("1");
  await expect(page.getByTestId("sheet-species")).toHaveText(`Orcani E2E ${world.tag}`);
  for (const stat of s.mechanics.stats) {
    await expect(page.getByTestId(`sheet-stat-${stat.stat}`)).toHaveText(String(stat.total));
    await expect(page.getByTestId(`sheet-save-${stat.stat}`)).toHaveText(`+${stat.savingThrow.value}`);
  }
  await expect(page.getByTestId("sheet-core-die")).toHaveText("Character Died4");
  const range = s.mechanics.combat.range as { value: number };
  await expect(page.getByTestId("sheet-core-range")).toHaveText(`Sight (Range)${range.value} ft`);
  await expect(page.getByTestId("sheet-skill").filter({ hasText: "Performance E2E" })).toHaveCount(1);
  await expect(page.getByTestId("sheet-resource-max-HP")).toHaveText(`/ ${max(s, "HP")}`);

  // Resources: inline, current values only.
  await page.getByRole("button", { name: "Decrease HP (Health)" }).click();
  await expect(page.getByLabel("Current HP (Health)")).toHaveValue(String(max(s, "HP") - 1));
  const mp = page.getByLabel("Current MP (Mana)");
  await mp.fill("3");
  await mp.press("Enter");
  await expect(mp).toHaveValue("3");
  await page.getByRole("button", { name: "Decrease AP (Action Points)" }).click();
  await expect(page.getByLabel("Current AP (Action Points)")).toHaveValue(String(max(s, "AP") - 1));
  await page.getByRole("button", { name: "Decrease Counter Actions" }).click();
  await expect(page.getByLabel("Current Counter Actions")).toHaveValue("0");
  await expect(page.getByRole("button", { name: "Increase HP (Health)" })).toBeEnabled();

  // Notes autosave (text only).
  await page.getByLabel("Company / PAC").fill("Harbor Watch PAC");
  await page.getByTestId("sheet-action-notes").fill("Strike, then Dodge.\nKeep 1 AP for a Counter.");
  await page.getByTestId("sheet-character-notes").fill("Owes the harbormaster a favor.");
  await expect(page.getByTestId("sheet-notes-status")).toHaveText("All notes saved.");

  await page.reload();
  await expect(page.getByLabel("Current HP (Health)")).toHaveValue(String(max(s, "HP") - 1));
  await expect(page.getByLabel("Current MP (Mana)")).toHaveValue("3");
  await expect(page.getByLabel("Current AP (Action Points)")).toHaveValue(String(max(s, "AP") - 1));
  await expect(page.getByLabel("Current Counter Actions")).toHaveValue("0");
  await expect(page.getByLabel("Company / PAC")).toHaveValue("Harbor Watch PAC");
  await expect(page.getByTestId("sheet-action-notes")).toHaveValue("Strike, then Dodge.\nKeep 1 AP for a Counter.");
  await expect(page.getByTestId("sheet-character-notes")).toHaveValue("Owes the harbormaster a favor.");
  // Notes changed no mechanics.
  await expect(page.getByTestId("sheet-level")).toHaveText("1");
  await expect(page.getByTestId("sheet-resource-max-HP")).toHaveText(`/ ${max(s, "HP")}`);
});

test("a player uploads, frames, replaces and removes the portrait; the framing survives a reload", async ({ page, request }) => {
  test.setTimeout(180_000);
  const c = await completedCharacter(request, world, `Portrait ${world.tag}`);
  await openSheet(page, c.id);
  await expect(page.getByTestId("portrait-placeholder")).toBeVisible();
  await page.getByRole("button", { name: "Add portrait" }).click();
  const dialog = page.getByRole("dialog", { name: "Character portrait" });
  await dialog.getByLabel("Upload portrait image").setInputFiles({ name: "portrait.png", mimeType: "image/png", buffer: Buffer.from(PORTRAIT_PNG_96x64) });
  const frame = dialog.getByTestId("portrait-editor-frame");
  await expect(frame).toBeVisible();
  await dialog.getByLabel("Zoom").fill("2");
  const box = (await frame.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 - 20, { steps: 5 });
  await page.mouse.up();
  await dialog.getByRole("button", { name: "Save framing" }).click();
  await expect(dialog.getByTestId("portrait-message")).toHaveText("Framing saved.");
  await dialog.getByRole("button", { name: "Close" }).click();
  const shown = page.getByTestId("portrait-photo").getByTestId("portrait-image");
  const zoom = await shown.getAttribute("data-zoom");
  const offsetX = await shown.getAttribute("data-offset-x");
  const offsetY = await shown.getAttribute("data-offset-y");
  expect(zoom).toBe("2");
  expect(Number(offsetX)).toBeLessThan(0); // dragged right → more of the left side
  expect(Number(offsetY)).toBeGreaterThan(0); // dragged up → more of the bottom

  await page.reload();
  const reloaded = page.getByTestId("portrait-photo").getByTestId("portrait-image");
  await expect(reloaded).toHaveAttribute("data-zoom", zoom as string);
  await expect(reloaded).toHaveAttribute("data-offset-x", offsetX as string);
  await expect(reloaded).toHaveAttribute("data-offset-y", offsetY as string);
  expect(await reloaded.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(96);
  // Aspect ratio preserved: the rendered (untransformed) box keeps 96:64 — the photo's slight tilt is decoration.
  const size = await reloaded.evaluate((img: HTMLImageElement) => ({ w: img.offsetWidth, h: img.offsetHeight }));
  expect(size.w / size.h).toBeCloseTo(96 / 64, 1);

  await page.getByRole("button", { name: "Edit portrait" }).click();
  await page.getByRole("dialog").getByLabel("Replace portrait image").setInputFiles({ name: "new.jpg", mimeType: "image/jpeg", buffer: Buffer.from(PORTRAIT_JPEG_30x40) });
  await expect(page.getByRole("dialog").getByTestId("portrait-message")).toHaveText("Portrait replaced.");
  await expect(page.getByTestId("portrait-photo").getByTestId("portrait-image")).toHaveAttribute("data-zoom", "1");
  await page.getByRole("dialog").getByRole("button", { name: "Remove portrait" }).click();
  await expect(page.getByRole("dialog").getByTestId("portrait-message")).toHaveText("Portrait removed.");
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("portrait-placeholder")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("portrait-placeholder")).toBeVisible();
});

test("an advanced Character's sheet shows its present Level, die, Skills and Affinities (no stale Level 1 view)", async ({ page, request }) => {
  test.setTimeout(180_000);
  const c = await completedCharacter(request, world, `Veteran ${world.tag}`);
  let lockVersion = c.lockVersion;
  for (const choices of [
    { statAllocations: { PER: 1 }, skillAdvancements: [], affinityChoice: null },
    { statAllocations: { PRO: 1 }, skillAdvancements: [{ action: "UPGRADE", skill: sel(world, "skill.athletics") }], affinityChoice: null },
    { statAllocations: { AGI: 1 }, skillAdvancements: [], affinityChoice: null },
    { statAllocations: { CON: 1 }, skillAdvancements: [{ action: "UPGRADE", skill: sel(world, "skill.arcana") }], affinityChoice: null },
    { statAllocations: { RES: 1 }, skillAdvancements: [{ action: "TRAIN_NEW", skill: sel(world, "skill.martial") }], affinityChoice: { optionKey: "PRIMARY_EXPERT", affinity: null } },
  ]) {
    lockVersion = (await post<{ lockVersion: number }>(request, `/api/characters/${c.id}/advance`, { expectedLockVersion: lockVersion, choices })).lockVersion;
  }
  const s = await sheetJson(request, c.id);
  expect(s.identity.level).toBe(6);
  await openSheet(page, c.id);
  await expect(page.getByTestId("sheet-level")).toHaveText("6");
  await expect(page.getByTestId("sheet-core-die")).toHaveText(`Character Died${(s.mechanics.combat.characterDie as { faces: number }).faces}`);
  const row = (name: string) => page.getByTestId("sheet-skill").filter({ hasText: name });
  await expect(row("Arcana E2E").getByTestId("sheet-skill-rank-EXPERT")).toHaveAttribute("data-held", "true");
  await expect(row("Arcana E2E").getByTestId("sheet-skill-score")).toHaveText("+4");
  await expect(row("Martial E2E").getByTestId("sheet-skill-rank-TRAINED")).toHaveAttribute("data-held", "true");
  await expect(row("Martial E2E").getByTestId("sheet-skill-rank-EXPERT")).toHaveAttribute("data-held", "false");
  await expect(page.getByTestId("sheet-affinity-row").first()).toContainText("Primary, Expert");
  for (const stat of s.mechanics.stats) await expect(page.getByTestId(`sheet-stat-${stat.stat}`)).toHaveText(String(stat.total));
  await expect(page.getByTestId("sheet-resource-max-HP")).toHaveText(`/ ${max(s, "HP")}`);
  // The structured history is still one tab away.
  await page.getByRole("tab", { name: "History" }).click();
  for (const level of [2, 3, 4, 5, 6]) await expect(page.getByTestId(`history-level-${level}`)).toBeVisible();
});

test("a newer Release with a revised Range Formula never changes the existing Character's sheet", async ({ page, request }) => {
  test.setTimeout(180_000);
  const c = await completedCharacter(request, world, `Historian ${world.tag}`);
  const before = await sheetJson(request, c.id);
  const rangePin = world.pins.get("core.derived.base_range")!;
  const old = await (await request.get(`/api/entity-versions/${rangePin.entityVersionId}`)).json();
  const payload = old.data.structuredData.prowessDefinition.payload;
  const revised = { ...payload, formula: { ...payload.formula, expression: "20 * per" } };
  const v = await post<Id>(request, `/api/entities/${rangePin.entityId}/versions`, { displayName: "Base Range (revised)", structuredData: { prowessDefinition: { ...old.data.structuredData.prowessDefinition, payload: revised } }, shortDescription: "revised — E2E test fixture" });
  await post(request, `/api/entity-versions/${v.id}/status`, { status: "IN_REVIEW" });
  await post(request, `/api/entity-versions/${v.id}/status`, { status: "APPROVED" });
  const cs = await post<Id>(request, `/api/rulesets/${world.rulesetId}/change-sets`, { name: `Range ${world.tag}`, operations: [{ operationType: "REPLACE_ENTITY_VERSION", targetEntityId: rangePin.entityId, fromEntityVersionId: rangePin.entityVersionId, toEntityVersionId: v.id }] });
  await post(request, `/api/change-sets/${cs.id}/submit-review`);
  await post(request, `/api/change-sets/${cs.id}/approve`);
  await post(request, `/api/rulesets/${world.rulesetId}/releases`, { baseManifestId: world.r1.manifestId, canonPolicyId: world.policyId, changeSetId: cs.id, versionLabel: "0.2.0" });
  const after = await sheetJson(request, c.id);
  expect(after.mechanics).toEqual(before.mechanics);
  await openSheet(page, c.id);
  await expect(page.getByTestId("sheet-release")).toContainText(`${world.rulesetName} — Release 1 (0.1.0)`);
  await expect(page.getByTestId("sheet-core-range")).toHaveText(`Sight (Range)${(before.mechanics.combat.range as { value: number }).value} ft`);
});

test("the print view is two Letter pages with no controls, each section on its own page", async ({ page }) => {
  test.setTimeout(120_000);
  expect(notesCharacter).not.toBe("");
  await page.goto(`/characters/${notesCharacter}/print`);
  await page.emulateMedia({ media: "print" });
  const sheet = page.getByTestId("character-sheet");
  await expect(sheet).toHaveAttribute("data-mode", "print");
  await expect(sheet.getByRole("button")).toHaveCount(0);
  await expect(sheet.getByRole("textbox")).toHaveCount(0);
  await expect(sheet.getByRole("link")).toHaveCount(0);
  await expect(page.getByTestId("sheet-page-supplement")).toHaveCount(0);
  const p1 = page.getByTestId("sheet-page-1");
  const p2 = page.getByTestId("sheet-page-2");
  for (const name of ["Stats", "Core Values & Combat", "Resources", "Skills", "Actions"]) await expect(p1.getByRole("heading", { name, exact: true })).toBeVisible();
  for (const name of ["Granted Effects & Conditions", "Affinity Profile", "Equipment & Gear", "Attunement", "Carry & Weight", "Possessions", "Character Notes"]) await expect(p2.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(page.getByTestId("sheet-action-notes")).toContainText("Strike, then Dodge.");
  // No page grows past one Letter page (96 px per inch), so nothing spills or is clipped.
  for (const p of [p1, p2]) expect((await p.boundingBox())!.height).toBeLessThanOrEqual(11 * 96 + 1);
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  expect(pages).toBe(2);
});
