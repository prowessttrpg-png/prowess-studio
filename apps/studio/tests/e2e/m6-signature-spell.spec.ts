import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { completedCharacter, post, put, type Id, type World } from "./m6-wo5-world";
import { seedSpells } from "./m6-wo7-world";

/**
 * PAS-10 M6-WO7 §156–§160 — the Signature Spell Builder through the REAL Studio UI, against a capable Release published
 * through the existing API (test-only Spell components; tests/e2e/m6-wo7-world.ts).
 *
 * 1. §156 simple builder: Abilities → New Spell → Concept → Arcane → Single Target → Arcane Bolt → Instant → Review →
 *    Finalize → listed in Abilities → listed in the Sheet's Actions.
 * 2. §157 Affinity builder: owned Evocation (Trained at Level 3), aligned Effect, Strength discount; finalize, reload,
 *    same cost.
 * 3. §158 invalid Targeting / Effect combination: Review shows the exact failure, Finalize is unavailable, the draft is saved.
 * 4. §159 rebuild: add a Trait → validate → finalize Revision 2 → current updates → history keeps Revision 1.
 * 5. §160 a newer Release revising the Effect leaves the Release-1 Character's Spell on its Release-1 mechanics.
 * Invariants: M6-I077 M6-I080 M6-I083 M6-I084 M6-I086 M6-I089 M6-I090 M6-I092 M6-I093 M6-I095 M6-I098.
 */
test.describe.configure({ mode: "serial" });
let world: World;
test.beforeAll(async ({ playwright, baseURL }) => {
  test.setTimeout(600_000);
  const request = await playwright.request.newContext({ baseURL });
  world = await seedSpells(request);
  await request.dispose();
});

const ref = (key: string) => ({ ...world.pins.get(key)! });
const pick = (key: string, parameters: Record<string, unknown> = {}) => ({ definition: ref(key), parameters });
/** A complete simple Arcane Spell's selections (§135): Single Target, Arcane Bolt (8 listed MP), Instant. */
const simple = (name: string) => ({
  schemaVersion: 1,
  concept: { name, description: "", visualDescription: "", notes: "", narrativeTags: [] },
  authority: "ARCANE_AUTHORITY",
  affinity: null,
  targeting: pick("spell.targeting.single_target"),
  effects: [{ componentKey: "effect1", order: 1, ...pick("fixture.wo10.effect.damage", { dice: 1, mp: 8 }) }],
  effectChain: null,
  traits: [],
  duration: pick("spell.duration.instant"),
  castingConditions: [],
  constructionOptions: { effectSlotsTradedForTraits: 0 },
  additionalAffinityTraits: [],
});
type Detail = { spell: { id: string; lockVersion: number; status: string; current: { revisionNumber: number; evaluation: { cost: { finalMpCost: number; finalApCost: number } | null } } | null } };
async function finalizedSpell(request: APIRequestContext, characterId: string, name: string): Promise<Detail> {
  const created = await post<Detail>(request, `/api/characters/${characterId}/spells`, { name });
  const saved = await put<Detail>(request, `/api/characters/${characterId}/spells/${created.spell.id}/draft`, { expectedVersion: created.spell.lockVersion, draft: simple(name) });
  return post<Detail>(request, `/api/characters/${characterId}/spells/${created.spell.id}/finalize`, { expectedVersion: saved.spell.lockVersion });
}
const option = (page: Page, picker: string, name: string) => page.getByTestId(picker).getByTestId("spell-option").filter({ hasText: name });
async function step(page: Page, key: string) {
  await page.getByTestId(`spell-step-${key}`).click();
  await expect(page.getByTestId(`spell-panel-${key}`)).toBeVisible();
}
async function saved(page: Page) {
  await expect(page.getByTestId("spell-save-state")).toHaveAttribute("data-save", "saved", { timeout: 20_000 });
}
/** Builds Targeting / Effect / Duration in the open builder (the Effect gets 8 listed MP). */
async function compose(page: Page, targeting: string) {
  await step(page, "TARGETING");
  await option(page, "spell-targeting-picker", targeting).getByRole("radio").check();
  await step(page, "EFFECTS");
  await option(page, "spell-effect-picker", "Arcane Bolt").getByTestId("spell-option-add").click();
  await expect(page.getByTestId("spell-effect")).toHaveCount(1);
  await page.getByTestId("spell-effect").getByTestId("spell-parameter-mp").fill("8");
  await step(page, "DURATION");
  await option(page, "spell-duration-picker", "Instant").getByRole("radio").check();
  await saved(page);
}
async function newSpell(page: Page, characterId: string, name: string) {
  await page.goto(`/characters/${characterId}?view=abilities`);
  await expect(page.getByTestId("abilities-panel")).toBeVisible();
  await page.getByTestId("abilities-new-spell").click();
  await page.getByTestId("spell-new-name").fill(name);
  await page.getByTestId("spell-new-start").click();
  await expect(page.getByTestId("spell-builder")).toBeVisible();
}

test("§156 a simple Arcane Spell is built step by step, finalized, and appears in Abilities and the Sheet's Actions", async ({ page, request }) => {
  test.setTimeout(240_000);
  const c = await completedCharacter(request, world, `Caster ${world.tag}`);
  await newSpell(page, c.id, "Ember Bolt");
  // Ten steps; nothing is preselected and the cost is unresolved (never zero) until the Spell is complete.
  await expect(page.getByRole("tablist", { name: "Spell builder steps" }).getByRole("tab")).toHaveCount(10);
  await expect(page.getByTestId("spell-live").getByTestId("spell-cost")).toHaveAttribute("data-resolved", "false");
  await expect(page.getByTestId("spell-name")).toHaveValue("Ember Bolt");
  await step(page, "AUTHORITY");
  await expect(page.getByTestId("spell-authority-ARCANE_AUTHORITY")).not.toBeChecked();
  await page.getByTestId("spell-authority-ARCANE_AUTHORITY").check();
  await compose(page, "Single Target");
  await expect(page.getByTestId("spell-live").getByTestId("spell-state")).toHaveAttribute("data-state", "VALID");
  const api = (await (await request.get(`/api/characters/${c.id}/abilities`)).json()).data as { spells: Array<{ id: string; draft: { evaluation: { cost: { finalMpCost: number; finalApCost: number } } } }> };
  const cost = api.spells[0]!.draft.evaluation.cost;
  expect(cost.finalMpCost).toBe(11); // 3 Single Target + 8 listed — the server's M5-WO10 result
  await expect(page.getByTestId("spell-live").getByTestId("spell-final-mp")).toHaveText("11 MP");
  await expect(page.getByTestId("spell-live").getByTestId("spell-final-ap")).toHaveText(`${cost.finalApCost} AP`);
  await step(page, "REVIEW");
  await expect(page.getByTestId("spell-review-name")).toHaveText("Ember Bolt");
  await expect(page.getByTestId("spell-review-effect")).toHaveCount(1);
  await step(page, "FINALIZE");
  await expect(page.getByTestId("spell-finalize-slots")).toContainText("after finalizing 1 /");
  await page.getByTestId("spell-finalize").click();
  await expect(page.getByTestId("spell-detail")).toBeVisible();
  await expect(page.getByTestId("spell-detail-status")).toHaveText("Active");
  await expect(page.getByTestId("spell-detail-revision")).toHaveText("Revision 1");
  // Abilities lists it with the server's AP / MP; the Sheet's Actions show the compact line.
  await page.goto(`/characters/${c.id}?view=abilities`);
  const row = page.getByTestId("abilities-spell-row").filter({ hasText: "Ember Bolt" });
  await expect(row.getByTestId("abilities-spell-mp")).toHaveText("11");
  await expect(row.getByTestId("abilities-spell-status")).toHaveText("Active");
  await expect(page.getByTestId("abilities-signature-slots")).toContainText("Signature slots used: 1 /");
  await page.goto(`/characters/${c.id}`);
  const line = page.getByTestId("sheet-spell-row").filter({ hasText: "Ember Bolt" });
  await expect(line.getByTestId("sheet-spell-cost")).toHaveText(`${cost.finalApCost} AP · 11 MP`);
  await expect(line.getByTestId("sheet-spell-targeting")).toContainText("Single Target");
  await expect(page.getByTestId("sheet-action-notes")).toBeVisible(); // Action Notes stay
});

test("§157 an Affinity Authority Spell with an owned, aligned Affinity gets the Strength discount; the cost survives a reload", async ({ page, request }) => {
  test.setTimeout(240_000);
  const c = await completedCharacter(request, world, `Evoker ${world.tag}`);
  let lockVersion = c.lockVersion;
  // Level 3 raises the Primary Affinity (Evocation) to Trained (the Release's Affinity progression).
  for (const choices of [
    { statAllocations: { PER: 1 }, skillAdvancements: [], affinityChoice: null },
    { statAllocations: { RES: 1 }, skillAdvancements: [{ action: "UPGRADE", skill: c.sel("skill.athletics") }], affinityChoice: null },
  ])
    lockVersion = (await post<{ lockVersion: number }>(request, `/api/characters/${c.id}/advance`, { expectedLockVersion: lockVersion, choices })).lockVersion;
  await newSpell(page, c.id, "Evoker's Lance");
  await step(page, "AUTHORITY");
  await page.getByTestId("spell-authority-AFFINITY_AUTHORITY").check();
  await page.getByTestId("spell-affinity-option").first().getByRole("radio").check();
  await expect(page.getByTestId("spell-affinity-option").first()).toContainText("Trained");
  await compose(page, "Single Target");
  await step(page, "EFFECTS");
  await expect(page.getByTestId("spell-effect-picker").getByTestId("spell-option").filter({ hasText: "Arcane Bolt" }).getByTestId("spell-option-alignment")).toHaveAttribute("data-alignment", "STRENGTH");
  await expect(page.getByTestId("spell-live").getByTestId("spell-cost")).toHaveAttribute("data-resolved", "true");
  const spells = ((await (await request.get(`/api/characters/${c.id}/abilities`)).json()).data as { spells: Array<{ id: string; draft: { evaluation: { state: string; cost: { finalMpCost: number; finalApCost: number; percentages: Array<{ source: string; percent: number }> } } } }> }).spells;
  const e = spells[0]!.draft.evaluation;
  expect(e.state).toBe("VALID");
  expect(e.cost.percentages.some((q) => q.source === "AFFINITY_STRENGTH" && q.percent > 0)).toBe(true);
  expect(e.cost.finalMpCost).toBeLessThan(11);
  await expect(page.getByTestId("spell-live").getByTestId("spell-final-mp")).toHaveText(`${e.cost.finalMpCost} MP`);
  await step(page, "FINALIZE");
  await page.getByTestId("spell-finalize").click();
  await expect(page.getByTestId("spell-detail")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("spell-detail").getByTestId("spell-final-mp").first()).toHaveText(`${e.cost.finalMpCost} MP`);
  await expect(page.getByTestId("spell-review-authority").first()).toContainText("Affinity Authority");
});

test("§158 an invalid Targeting / Effect combination: Review names the failure, Finalize is unavailable, the draft is kept", async ({ page, request }) => {
  test.setTimeout(240_000);
  const c = await completedCharacter(request, world, `Misfit ${world.tag}`);
  await newSpell(page, c.id, "Wide Bolt");
  await step(page, "AUTHORITY");
  await page.getByTestId("spell-authority-ARCANE_AUTHORITY").check();
  await compose(page, "Radius");
  await expect(page.getByTestId("spell-live").getByTestId("spell-state")).toHaveAttribute("data-state", "INVALID");
  await step(page, "REVIEW");
  await expect(page.getByTestId("spell-issue").first()).toBeVisible();
  const issues = (await page.getByTestId("spell-issue").allTextContents()).join(" | ");
  expect(issues).toMatch(/RADIUS|Radius|targeting|Targeting/);
  await expect(page.getByTestId("spell-live").getByTestId("spell-cost")).toHaveAttribute("data-resolved", "false");
  await step(page, "FINALIZE");
  await expect(page.getByTestId("spell-finalize")).toBeDisabled();
  await expect(page.getByTestId("spell-finalize-unavailable")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("spell-builder")).toBeVisible();
  await step(page, "EFFECTS");
  await expect(page.getByTestId("spell-effect")).toHaveCount(1);
  const abilities = (await (await request.get(`/api/characters/${c.id}/abilities`)).json()).data as { signature: { used: number }; spells: Array<{ status: string; state: string }> };
  expect(abilities.spells.map((s) => [s.status, s.state])).toEqual([["DRAFT", "INVALID"]]);
  expect(abilities.signature.used).toBe(0); // a draft uses no Signature slot
});

test("§159 a rebuild adds a Trait, finalizes Revision 2 and keeps Revision 1 in the history", async ({ page, request }) => {
  test.setTimeout(240_000);
  const c = await completedCharacter(request, world, `Rebuilder ${world.tag}`);
  const first = await finalizedSpell(request, c.id, "Ember Bolt");
  expect(first.spell.current!.revisionNumber).toBe(1);
  await page.goto(`/characters/${c.id}/spells/${first.spell.id}`);
  await page.getByTestId("spell-detail-rebuild").click();
  await page.getByTestId("spell-start-rebuild").click();
  await expect(page.getByTestId("spell-builder")).toBeVisible();
  await step(page, "TRAITS");
  await option(page, "spell-trait-picker", "Flat").getByTestId("spell-option-add").click();
  await expect(page.getByTestId("spell-trait")).toHaveCount(1);
  await saved(page);
  await step(page, "REVIEW");
  await page.getByTestId("spell-validate").click();
  await expect(page.getByTestId("spell-message")).toContainText("ready to finalize");
  await step(page, "FINALIZE");
  await expect(page.getByTestId("spell-finalize")).toHaveText("Finalize Revision 2");
  await page.getByTestId("spell-finalize").click();
  await expect(page.getByTestId("spell-detail")).toBeVisible();
  await expect(page.getByTestId("spell-detail-revision")).toHaveText("Revision 2");
  const history = page.getByTestId("spell-history-row");
  await expect(history).toHaveCount(2);
  await expect(page.locator('[data-testid="spell-history-row"][data-revision="2"]')).toHaveAttribute("data-current", "true");
  await expect(page.locator('[data-testid="spell-history-row"][data-revision="1"]')).toHaveAttribute("data-current", "false");
  await expect(page.locator('[data-testid="spell-history-row"][data-revision="1"]').getByTestId("spell-history-mp")).toHaveText("11 MP");
  await expect(page.locator('[data-testid="spell-history-row"][data-revision="2"]').getByTestId("spell-history-mp")).toHaveText("13 MP"); // + the Trait's 2 listed MP
});

test("§160 a newer Release revising the Effect leaves the Release-1 Character's Spell on its exact Release-1 mechanics", async ({ page, request }) => {
  test.setTimeout(240_000);
  const c = await completedCharacter(request, world, `Historian ${world.tag}`);
  const spell = await finalizedSpell(request, c.id, "Old Bolt");
  const bolt = world.pins.get("fixture.wo10.effect.damage")!;
  const old = await (await request.get(`/api/entity-versions/${bolt.entityVersionId}`)).json();
  const def = old.data.structuredData.prowessDefinition;
  const payload = { ...def.payload, costContributions: [{ contributionKey: "effect.wo10.mp", currency: "MP", data: { amount: 2, includedUnits: 0, kind: "PER_UNIT", parameter: "mp" } }] };
  const v = await post<Id>(request, `/api/entities/${bolt.entityId}/versions`, { displayName: "Arcane Bolt (revised)", structuredData: { prowessDefinition: { ...def, payload } }, shortDescription: "revised — E2E test fixture" });
  await post(request, `/api/entity-versions/${v.id}/status`, { status: "IN_REVIEW" });
  await post(request, `/api/entity-versions/${v.id}/status`, { status: "APPROVED" });
  const cs = await post<Id>(request, `/api/rulesets/${world.rulesetId}/change-sets`, { name: `Arcane Bolt ${world.tag}`, operations: [{ operationType: "REPLACE_ENTITY_VERSION", targetEntityId: bolt.entityId, fromEntityVersionId: bolt.entityVersionId, toEntityVersionId: v.id }] });
  await post(request, `/api/change-sets/${cs.id}/submit-review`);
  await post(request, `/api/change-sets/${cs.id}/approve`);
  await post(request, `/api/rulesets/${world.rulesetId}/releases`, { baseManifestId: world.r1.manifestId, canonPolicyId: world.policyId, changeSetId: cs.id, versionLabel: "0.2.0" });
  const after = (await (await request.get(`/api/characters/${c.id}/spells/${spell.spell.id}`)).json()).data as Detail;
  expect(after.spell.current!.evaluation.cost!.finalMpCost).toBe(11);
  await page.goto(`/characters/${c.id}/spells/${spell.spell.id}`);
  await expect(page.getByTestId("spell-detail").getByTestId("spell-final-mp").first()).toHaveText("11 MP");
  // Every component link is the Character's exact Release-1 revision.
  const versions = await page.getByTestId("spell-component-link").evaluateAll((els) => els.map((e) => e.getAttribute("data-version")));
  expect(versions).toContain(bolt.entityVersionId);
  expect(versions).not.toContain(v.id);
});
