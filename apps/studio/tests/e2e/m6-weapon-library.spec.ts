import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { post, put, type Id, type World } from "./m6-wo5-world";
import { martialCharacter, seedWeapons } from "./m6-wo6-world";

/**
 * PAS-10 M6-WO6 §165–§168 — Weapons on the Digital Character Sheet through the REAL Studio UI, against a capable
 * Release published through the existing API (test-only content; tests/e2e/m6-wo6-world.ts).
 *
 * 1. §165 Long Blade two-handed: Slash / Stab / Bash with STR-scaled previews; the loadout persists across a reload.
 * 2. §166 Long Blade + Light Shield: Armor / Dodge update and Shield Bash appears; removing the Shield reverts them.
 * 3. §167 Rifle: STATIC damage, Loading / Reload / Loud, its range, Single / Burst / Auto Moves and no Power.
 * 4. §168 a newer Release revising Long Blade Slash leaves the Character's exact Release-1 Weapon and Attack.
 * Invariants: M6-I057 M6-I061 M6-I064 M6-I066 M6-I068 M6-I069 M6-I076.
 */
test.describe.configure({ mode: "serial" });
let world: World;
test.beforeAll(async ({ playwright, baseURL }) => {
  test.setTimeout(420_000);
  const request = await playwright.request.newContext({ baseURL });
  world = await seedWeapons(request);
  await request.dispose();
});

type SheetJson = { mechanics: { combat: Record<string, { value: number | null }> }; weaponAttacks: Array<{ moveKey: string; attack: { entityVersionId: string } }> };
async function sheetJson(request: APIRequestContext, id: string): Promise<SheetJson> {
  const r = await request.get(`/api/characters/${id}/sheet`);
  expect(r.ok()).toBe(true);
  return (await r.json()).data as SheetJson;
}
async function openSheet(page: Page, id: string) {
  await page.goto(`/characters/${id}`);
  await expect(page.getByTestId("sheet-page-1")).toBeVisible();
}
async function chooseWeapons(page: Page, choice: { main: string | null; grip?: "One-handed" | "Two-handed"; off?: string | null }) {
  await page.getByTestId("sheet-loadout-edit").click();
  await page.getByTestId("sheet-loadout-main").selectOption(choice.main === null ? { label: "None" } : { label: choice.main });
  if (choice.grip !== undefined) await page.getByTestId("sheet-loadout-grip").selectOption({ label: choice.grip });
  if (choice.off !== undefined) await page.getByTestId("sheet-loadout-off").selectOption(choice.off === null ? { label: "None" } : { label: choice.off });
  await page.getByTestId("sheet-loadout-save").click();
  await expect(page.getByTestId("sheet-loadout-form")).toHaveCount(0);
}
const rows = (page: Page, hand: string) => page.getByTestId(`sheet-attacks-${hand}`).getByTestId("sheet-attack-row");

test("§165 a two-handed Long Blade lists Slash / Stab / Bash with the Character's STR-scaled damage and persists", async ({ page, request }) => {
  test.setTimeout(180_000);
  const c = await martialCharacter(request, world, `Blade ${world.tag}`);
  await openSheet(page, c.id);
  await expect(page.getByTestId("sheet-main-hand")).toHaveText("None");
  await expect(page.getByTestId("sheet-off-hand")).toHaveText("None");
  await expect(rows(page, "unarmed")).not.toHaveCount(0); // Unarmed stays available with no Weapon
  await chooseWeapons(page, { main: "Long Blade", grip: "Two-handed" });
  await expect(page.getByTestId("sheet-main-hand")).toContainText("Long Blade");
  await expect(page.getByTestId("sheet-main-hand")).toContainText("Two-handed grip");
  await expect(page.getByTestId("sheet-main-hand")).toContainText("Power 6");
  const main = rows(page, "main_hand");
  await expect(main).toHaveCount(3);
  await expect(main.getByTestId("sheet-attack-damage")).toHaveText(["2d10 Slashing", "2d8 Piercing", "2d6 Bludgeoning"]); // STR 6 ÷ Power 6 → ×2
  await expect(main.getByTestId("sheet-attack-ap")).toHaveText(["2", "2", "1"]);
  await page.reload();
  await expect(page.getByTestId("sheet-main-hand")).toContainText("Two-handed grip");
  await expect(rows(page, "main_hand").getByTestId("sheet-attack-damage")).toHaveText(["2d10 Slashing", "2d8 Piercing", "2d6 Bludgeoning"]);
});

test("§166 a Light Shield beside a one-handed Long Blade updates Armor / Dodge and adds Shield Bash; removing it reverts", async ({ page, request }) => {
  test.setTimeout(180_000);
  const c = await martialCharacter(request, world, `Shield ${world.tag}`);
  const before = await sheetJson(request, c.id);
  const value = (s: SheetJson, k: string) => s.mechanics.combat[k]!.value as number;
  await openSheet(page, c.id);
  await chooseWeapons(page, { main: "Long Blade", grip: "One-handed", off: "Light Shield" });
  await expect(page.getByTestId("sheet-off-hand")).toContainText("Light Shield");
  await expect(rows(page, "off_hand").first()).toHaveAttribute("data-move", "SHIELD_BASH");
  const equipped = await sheetJson(request, c.id);
  expect([value(equipped, "armor"), value(equipped, "dodge")]).toEqual([value(before, "armor") + 1, value(before, "dodge") + 1]);
  await expect(page.getByTestId("sheet-core-armor")).toContainText(String(value(equipped, "armor")));
  await expect(page.getByTestId("sheet-core-dodge")).toContainText(String(value(equipped, "dodge")));
  await expect(page.getByTestId("sheet-dual-wield")).toHaveCount(0); // a Shield + Weapon is never Dual Wielding
  await chooseWeapons(page, { main: "Long Blade", grip: "One-handed", off: null });
  await expect(page.getByTestId("sheet-off-hand")).toHaveText("None");
  await expect(page.getByTestId("sheet-attacks-off_hand")).toHaveCount(0);
  const after = await sheetJson(request, c.id);
  expect(after.mechanics).toEqual(before.mechanics);
});

test("§167 a Rifle shows STATIC damage, Loading / Reload / Loud, its range and Single / Burst / Auto Moves — no Power", async ({ page, request }) => {
  test.setTimeout(180_000);
  const c = await martialCharacter(request, world, `Rifle ${world.tag}`);
  await openSheet(page, c.id);
  await chooseWeapons(page, { main: "Rifle" });
  const slot = page.getByTestId("sheet-main-hand");
  await expect(slot).toContainText("Rifle");
  await expect(slot).toContainText("Static damage");
  for (const p of ["Loading 12", "Reload 3", "Loud 200"]) await expect(slot).toContainText(p);
  await expect(slot).not.toContainText("Power");
  const main = rows(page, "main_hand");
  await expect(main).toHaveCount(3);
  expect(await main.evaluateAll((els) => els.map((e) => e.getAttribute("data-move")))).toEqual(["SINGLE_SHOT", "BURST", "AUTO_FIRE"]);
  await expect(main.getByTestId("sheet-attack-damage")).toHaveText(["1d12 Piercing", "2d12 Piercing", "1d12 Piercing"]); // STR never scales a STATIC Weapon
  await expect(main.first().getByTestId("sheet-attack-range")).toContainText("ft (40 ft × PER)");
  await expect(main.nth(2).getByTestId("sheet-attack-range")).toHaveText("10-ft Line");
});

test("§168 a newer Release revising Long Blade Slash leaves the Character's exact Release-1 Weapon and Attack", async ({ page, request }) => {
  test.setTimeout(240_000);
  const c = await martialCharacter(request, world, `Historian ${world.tag}`);
  const blade = world.pins.get("weapon.long_blade")!;
  const slash = world.pins.get("attack.long_blade.slash")!;
  await put(request, `/api/characters/${c.id}/weapon-loadout`, { expectedVersion: 0, mainHand: { entityId: blade.entityId, entityVersionId: blade.entityVersionId }, mainHandGrip: "ONE_HANDED", offHand: null });
  const before = await sheetJson(request, c.id);
  // Release 2: Slash revised (1d12), and the Long Blade revised to pin that exact new Attack revision.
  const revise = async (pin: typeof slash, edit: (p: Record<string, unknown>) => Record<string, unknown>, displayName: string) => {
    const old = await (await request.get(`/api/entity-versions/${pin.entityVersionId}`)).json();
    const def = old.data.structuredData.prowessDefinition;
    const v = await post<Id>(request, `/api/entities/${pin.entityId}/versions`, { displayName, structuredData: { prowessDefinition: { ...def, payload: edit(def.payload) } }, shortDescription: "revised — E2E test fixture" });
    await post(request, `/api/entity-versions/${v.id}/status`, { status: "IN_REVIEW" });
    await post(request, `/api/entity-versions/${v.id}/status`, { status: "APPROVED" });
    return v.id;
  };
  const slash2 = await revise(slash, (p) => ({ ...p, damageProfiles: [{ profileKey: "slashing", dice: { count: 1, sides: 12 }, damageType: "SLASHING" }] }), "Long Blade — Slash (revised)");
  const blade2 = await revise(blade, (p) => ({ ...p, moveset: (p.moveset as Array<{ entityVersionId: string }>).map((m) => (m.entityVersionId === slash.entityVersionId ? { ...m, entityVersionId: slash2 } : m)) }), "Long Blade (revised)");
  const cs = await post<Id>(request, `/api/rulesets/${world.rulesetId}/change-sets`, {
    name: `Long Blade ${world.tag}`,
    operations: [
      { operationType: "REPLACE_ENTITY_VERSION", targetEntityId: slash.entityId, fromEntityVersionId: slash.entityVersionId, toEntityVersionId: slash2 },
      { operationType: "REPLACE_ENTITY_VERSION", targetEntityId: blade.entityId, fromEntityVersionId: blade.entityVersionId, toEntityVersionId: blade2 },
    ],
  });
  await post(request, `/api/change-sets/${cs.id}/submit-review`);
  await post(request, `/api/change-sets/${cs.id}/approve`);
  await post(request, `/api/rulesets/${world.rulesetId}/releases`, { baseManifestId: world.r1.manifestId, canonPolicyId: world.policyId, changeSetId: cs.id, versionLabel: "0.2.0" });
  const after = await sheetJson(request, c.id);
  expect(after.weaponAttacks).toEqual(before.weaponAttacks);
  expect(after.weaponAttacks.some((a) => a.attack.entityVersionId === slash.entityVersionId)).toBe(true);
  expect(after.weaponAttacks.some((a) => a.attack.entityVersionId === slash2)).toBe(false);
  await openSheet(page, c.id);
  await expect(page.getByTestId("sheet-main-hand")).toContainText("Long Blade");
  await expect(rows(page, "main_hand").first().getByTestId("sheet-attack-damage")).toHaveText("2d8 Slashing"); // Release 1: 1d8 × 2
});
