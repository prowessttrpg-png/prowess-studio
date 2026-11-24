import { expect as baseExpect, test, type APIRequestContext, type Page } from "@playwright/test";
import { completedCharacter, post, type Id, type World } from "./m6-wo5-world";
import { seedSpells } from "./m6-wo7-world";

/**
 * RULES-WO1 Phase F (R18, §8) — a meaningful Spell Effect is authored in game language through the real Compendium UI,
 * published into a Release, and used in the Signature Spell builder with its cost evaluated by the server:
 *
 *   P11 "Flame Lash": deals damage on an attack roll (Ability attack) to a creature; the caster chooses how many dice
 *       (1–3) and Fire or Shock; it costs 2 MP plus 3 MP for each die after the first; on a failure nothing happens;
 *       it is instant; building with it needs Arcana (Trained); it works with Single Target. Every control is a list,
 *       a checkbox, a number or plain words — no property name, data type, key or syntax is typed. It is validated by
 *       the M5 reader, created as a Draft, approved and published (Release 2) through the existing API, and a Release-2
 *       Character's Spell builder offers it: 1 die → 3 + 2 = 5 MP, 2 dice → 3 + 2 + 3 = 8 MP (the server's results).
 *
 * The world is the M6-WO7 Spell world (test-only keys); nothing here is canon.
 */
const expect = baseExpect.configure({ timeout: 30_000 });
test.describe.configure({ mode: "serial" });
let world: World;
test.beforeAll(async ({ playwright, baseURL }) => {
  test.setTimeout(600_000);
  const request = await playwright.request.newContext({ baseURL });
  world = await seedSpells(request);
  await request.dispose();
});

async function addOption(page: Page, testId: string, words: string) {
  await page.getByTestId(`${testId}-new`).fill(words);
  await page.getByTestId(`${testId}-add`).click();
}
async function costOf(request: APIRequestContext, characterId: string) {
  const api = (await (await request.get(`/api/characters/${characterId}/abilities`)).json()).data as { spells: Array<{ draft: { evaluation: { state: string; cost: { finalMpCost: number } | null } } }> };
  return api.spells[0]!.draft.evaluation;
}

test("RULES-WO1 P11 a guided Spell Effect is published and built into a Spell with its evaluated cost (R18)", async ({ page, request }) => {
  test.setTimeout(420_000);
  const name = `Flame Lash E2E ${world.tag}`;
  await page.goto("/compendium/admin/new");
  await page.getByLabel("Definition family").selectOption("SPELL");
  await page.getByLabel("Definition kind").selectOption("SPELL_EFFECT");
  await page.getByLabel("Display Name (required)").fill(name);
  await page.getByRole("button", { name: "Suggest a Canonical Key from the Display Name" }).click();

  const mechanics = page.getByTestId("effect-mechanics");
  // No technical editing on the normal path: no contribution keys, no recursive data editor, no data types.
  await expect(page.getByText("Contribution key")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Add field/i })).toHaveCount(0);

  // What it does, and how it resolves.
  await mechanics.getByTestId("effect-family").selectOption({ label: "Damage" });
  await mechanics.getByTestId("effect-subfamily").selectOption({ label: "Direct" });
  await mechanics.getByTestId("effect-target-CREATURE").check();
  await mechanics.getByLabel("An attack roll").check();
  await mechanics.getByLabel("Kind of attack").selectOption({ label: "Ability attack" });

  // The caster's choices.
  await mechanics.getByTestId("effect-parameter-add").click();
  await mechanics.getByTestId("effect-parameter-0-name").fill("Dice");
  await mechanics.getByTestId("effect-parameter-0-default").fill("1");
  await mechanics.getByTestId("effect-parameter-0-max-fixed").check();
  await mechanics.getByTestId("effect-parameter-0-max-value").fill("3");
  await mechanics.getByTestId("effect-parameter-add").click();
  await mechanics.getByTestId("effect-parameter-1-name").fill("Damage type");
  await mechanics.getByTestId("effect-parameter-1-type-list").check();
  await addOption(page, "effect-parameter-1-options", "Fire");
  await addOption(page, "effect-parameter-1-options", "Shock");
  await mechanics.getByTestId("effect-parameter-1-default").selectOption({ label: "Fire" });

  // Costs: 2 MP, plus 3 MP for each die after the first.
  await mechanics.getByTestId("effect-cost-add").click();
  await mechanics.getByTestId("effect-cost-0-currency").selectOption("MP");
  await mechanics.getByTestId("effect-cost-0-amount").fill("2");
  await mechanics.getByTestId("effect-cost-add").click();
  await mechanics.getByTestId("effect-cost-1-currency").selectOption("MP");
  await mechanics.getByTestId("effect-cost-1-shape-perNumber").check();
  await mechanics.getByTestId("effect-cost-1-parameter").selectOption({ label: "Dice" });
  await mechanics.getByTestId("effect-cost-1-amount").fill("3");
  await mechanics.getByTestId("effect-cost-1-included").fill("1");
  await expect(mechanics.getByTestId("effect-cost-1-summary")).toHaveText("3 MP for each dice after the first 1");

  // What happens.
  await mechanics.getByTestId("effect-outcome-SUCCESS-add").selectOption({ label: "Deals damage" });
  await mechanics.getByTestId("effect-outcome-SUCCESS-0-diceParameter").selectOption({ label: "Dice" });
  await mechanics.getByTestId("effect-outcome-SUCCESS-0-damageTypeParameter").selectOption({ label: "Damage type" });
  await mechanics.getByTestId("effect-outcome-FAILURE-add").selectOption({ label: "Nothing happens" });

  // How long it lasts and what it takes to build with it (Arcana, Trained — chosen from the lists).
  await mechanics.getByTestId("effect-duration-INSTANT").check();
  await mechanics.getByTestId("effect-duration-default").selectOption({ label: "Instant" });
  await mechanics.getByTestId("effect-construction-add-skill").click();
  const requirement = mechanics.getByTestId("effect-construction-requirement-0");
  const arcana = world.pins.get("skill.arcana")!.canonicalKey;
  await expect(requirement.getByLabel("Skill").locator(`option[value="${arcana}"]`)).toHaveCount(1);
  await requirement.getByLabel("Skill").selectOption(arcana);
  await requirement.getByLabel("At least this rank").selectOption({ label: "Trained" });

  // It works with Single Target (a compatibility rule built from the relation list and plain words).
  await page.getByRole("button", { name: "Add compatibility rule" }).click();
  const rule = page.getByTestId("compatibility-rule").first();
  await rule.getByLabel("Relation").selectOption({ label: "Targeting" });
  await rule.getByRole("button", { name: "Add another label" }).click();
  await rule.getByLabel("Allowed label in plain words").fill("Single target");
  await rule.getByRole("button", { name: "Add", exact: true }).click();
  await expect(rule.getByTestId("compatibility-allowed")).toHaveCount(1);

  await page.getByRole("button", { name: "Validate Definition" }).click();
  await expect(page.getByRole("region", { name: "Validation" }).getByRole("status")).toContainText("PASS");
  await page.getByRole("button", { name: "Create Definition as Draft" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `${name} — Revision 1` })).toBeVisible();
  const [, entityId, versionId] = /entities\/([^/]+)\/revisions\/([^/?]+)/.exec(page.url())!;

  // The stored Definition is exactly the M5 Effect contract (read back from the server).
  const stored = (await (await request.get(`/api/entity-versions/${versionId}`)).json()).data.structuredData.prowessDefinition.payload;
  expect(stored.rules.effect.parameters).toEqual([
    { parameter: "dice", kind: "COUNT", minimum: 1, maximum: { kind: "FIXED", value: 3 }, increment: 1, default: 1 },
    { parameter: "damageType", kind: "TOKEN", allowed: ["FIRE", "SHOCK"], default: "FIRE" },
  ]);
  expect(stored.costContributions.map((c: { data: unknown }) => c.data)).toEqual([{ kind: "FIXED", amount: 2 }, { kind: "PER_UNIT", parameter: "dice", amount: 3, includedUnits: 1 }]);

  // Publish it: approve the revision and release it with the world's Spell components (Release 2).
  await post(request, `/api/entity-versions/${versionId}/status`, { status: "IN_REVIEW" });
  await post(request, `/api/entity-versions/${versionId}/status`, { status: "APPROVED" });
  const cs = await post<Id>(request, `/api/rulesets/${world.rulesetId}/change-sets`, { name: `Flame Lash ${world.tag}`, operations: [{ operationType: "ADD_ENTITY_TO_MANIFEST", targetEntityId: entityId, toEntityVersionId: versionId }] });
  await post(request, `/api/change-sets/${cs.id}/submit-review`);
  await post(request, `/api/change-sets/${cs.id}/approve`);
  const r2 = await post<Id & { manifestId: string }>(request, `/api/rulesets/${world.rulesetId}/releases`, { baseManifestId: world.r1.manifestId, canonPolicyId: world.policyId, changeSetId: cs.id, versionLabel: "0.2.0" });

  // A Release-2 Character builds a Spell with it; the server evaluates the cost from the authored contributions.
  const c = await completedCharacter(request, { ...world, r1: r2 }, `Lasher ${world.tag}`);
  await page.goto(`/characters/${c.id}?view=abilities`);
  await page.getByTestId("abilities-new-spell").click();
  await page.getByTestId("spell-new-name").fill("Lash");
  await page.getByTestId("spell-new-start").click();
  await page.getByTestId("spell-step-AUTHORITY").click();
  await page.getByTestId("spell-authority-ARCANE_AUTHORITY").check();
  await page.getByTestId("spell-step-TARGETING").click();
  await page.getByTestId("spell-targeting-picker").getByTestId("spell-option").filter({ hasText: "Single Target" }).getByRole("radio").check();
  await page.getByTestId("spell-step-EFFECTS").click();
  await page.getByTestId("spell-effect-picker").getByTestId("spell-option").filter({ hasText: name }).getByTestId("spell-option-add").click();
  await expect(page.getByTestId("spell-effect")).toHaveCount(1);
  await page.getByTestId("spell-step-DURATION").click();
  await page.getByTestId("spell-duration-picker").getByTestId("spell-option").filter({ hasText: "Instant" }).getByRole("radio").check();
  await expect(page.getByTestId("spell-save-state")).toHaveAttribute("data-save", "saved", { timeout: 20_000 });
  await expect(page.getByTestId("spell-live").getByTestId("spell-state")).toHaveAttribute("data-state", "VALID");
  const one = await costOf(request, c.id);
  expect(one.cost!.finalMpCost).toBe(5); // 3 (Single Target) + 2
  await expect(page.getByTestId("spell-live").getByTestId("spell-final-mp")).toHaveText("5 MP");

  await page.getByTestId("spell-step-EFFECTS").click();
  await page.getByTestId("spell-effect").getByTestId("spell-parameter-dice").fill("2");
  await expect(page.getByTestId("spell-save-state")).toHaveAttribute("data-save", "saved", { timeout: 20_000 });
  await expect(page.getByTestId("spell-live").getByTestId("spell-final-mp")).toHaveText("8 MP");
  const two = await costOf(request, c.id);
  expect(two.cost!.finalMpCost).toBe(8); // 3 + 2 + 3 for the second die
});
