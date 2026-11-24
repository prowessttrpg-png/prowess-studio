import { expect as baseExpect, test, type APIRequestContext, type Page } from "@playwright/test";
import { completedCharacter, post, type Id, type World } from "./m6-wo5-world";
import { seedSpells } from "./m6-wo7-world";

/**
 * RULES-WO1 Phase G (R18, §5, §8) — the remaining Spell / Maneuver components are authored in game language through the
 * real Compendium UI, published into a Release, and used in the Signature Spell builder, which the server evaluates:
 *
 *   P12 "Ember Ring" (Spell Targeting): everything in a circle around the caster — creatures, objects and the area; the
 *       caster may add size steps; its radius is 10 ft + 5 ft for each size step (a Formula composed from contributions,
 *       reading the component's own size choice); placed from the caster, no line of sight needed, line of effect and
 *       cover apply; it costs 4 MP plus 2 MP for each 5 ft step.
 *       "Steady Breath" (Casting Condition): the caster must hold a steady breath (a play-time check, recorded for the
 *       play runtime); it may be taken only when the Spell affects an area; it reduces the MP cost by 10%.
 *       Neither asks for a property name, data type, contribution key, recursive data editor or syntax. Both are
 *       validated by the M5 reader, created as Drafts, approved and published together (Release 2). A Release-2
 *       Character builds a Spell from Ember Ring + Detect Mana + Instant: 0 steps → 4 + 2 = 6 MP, 1 step → 8 MP (the
 *       server's results); adding Steady Breath lists a 10% reduction the server applies within the rank's cap.
 *   P13 Durations, Maneuver Conditions, Maneuver Targeting and Foundations: a Scene Spell Duration, an AP-or-MP Maneuver
 *       Condition, a performer-only Maneuver Targeting and a movement Foundation bound to it are authored the same way and
 *       stored exactly in their M5 contracts.
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

async function newDefinition(page: Page, family: string, kind: string, name: string) {
  await page.goto("/compendium/admin/new");
  await page.getByLabel("Definition family").selectOption(family);
  await page.getByLabel("Definition kind").selectOption(kind);
  await page.getByLabel("Display Name (required)").fill(name);
  await page.getByRole("button", { name: "Suggest a Canonical Key from the Display Name" }).click();
  // No technical editing on the normal path.
  await expect(page.getByText("Contribution key")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Add field/i })).toHaveCount(0);
}
async function createDraft(page: Page, request: APIRequestContext, name: string) {
  await page.getByRole("button", { name: "Validate Definition" }).click();
  await expect(page.getByRole("region", { name: "Validation" }).getByRole("status")).toContainText("PASS");
  await page.getByRole("button", { name: "Create Definition as Draft" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `${name} — Revision 1` })).toBeVisible();
  const [, entityId, versionId] = /entities\/([^/]+)\/revisions\/([^/?]+)/.exec(page.url())!;
  const payload = (await (await request.get(`/api/entity-versions/${versionId}`)).json()).data.structuredData.prowessDefinition.payload as Record<string, any>;
  return { entityId: entityId!, versionId: versionId!, payload };
}
async function approve(request: APIRequestContext, versionId: string) {
  await post(request, `/api/entity-versions/${versionId}/status`, { status: "IN_REVIEW" });
  await post(request, `/api/entity-versions/${versionId}/status`, { status: "APPROVED" });
}
async function evaluationOf(request: APIRequestContext, characterId: string) {
  const api = (await (await request.get(`/api/characters/${characterId}/abilities`)).json()).data as { spells: Array<{ draft: { evaluation: { state: string; cost: { finalMpCost: number; castingConditions: { listedPercent: number; effectivePercent: number } } | null } } }> };
  return api.spells[0]!.draft.evaluation;
}

test("RULES-WO1 P12 a guided Spell Targeting and Casting Condition are published and built into a Spell with its evaluated cost (R18)", async ({ page, request }) => {
  test.setTimeout(480_000);
  // ---- Ember Ring (Spell Targeting) ----
  const ring = `Ember Ring E2E ${world.tag}`;
  await newDefinition(page, "SPELL", "SPELL_TARGETING", ring);
  await page.getByLabel(/Semantic shape/).selectOption("RADIUS");
  const t = page.getByTestId("targeting-mechanics");
  await t.getByTestId("targeting-delivery-family").selectOption("AREA_DELIVERY");
  await t.getByTestId("targeting-cardinality-area").check();
  for (const c of ["CREATURE", "OBJECT", "AREA"]) await t.getByTestId(`targeting-target-${c}`).check();
  await t.getByTestId("targeting-parameter-add").click();
  await t.getByTestId("targeting-parameter-0-name").fill("Size steps");
  await t.getByTestId("targeting-range-model").selectOption("SELF");
  // Radius: 10 ft + 5 ft for each size step, composed from contributions (the server builds the Formula).
  await t.getByTestId("targeting-measure-RADIUS-status").selectOption("FORMULA");
  const radius = t.getByTestId("targeting-measure-RADIUS-distance").getByTestId("formula-add");
  await radius.getByLabel("New contribution shape").selectOption("CONSTANT");
  await radius.getByLabel("New contribution value").fill("10");
  await radius.getByRole("button", { name: "Add contribution" }).click();
  const distance = t.getByTestId("targeting-measure-RADIUS-distance");
  const terms = distance.getByTestId("formula-term");
  await expect(distance.getByTestId("formula-expression")).toHaveText("10");
  // The server has re-read the expression before the next contribution is added.
  await expect(distance.getByRole("button", { name: "Remove contribution 1 (10)" })).toBeVisible();
  await radius.getByLabel("New contribution shape").selectOption("SCALED");
  await radius.getByLabel("New contribution: source").selectOption({ label: "One of this component's size choices" });
  await radius.getByLabel("New contribution: size choice").selectOption("sizeSteps");
  await radius.getByLabel("New contribution multiplier").fill("5");
  await radius.getByRole("button", { name: "Add contribution" }).click();
  await expect(terms).toHaveCount(2);
  await expect(t.getByTestId("targeting-measure-RADIUS-distance").getByTestId("formula-expression")).toHaveText("10 + 5 * size_steps");
  await t.getByTestId("targeting-origin-CASTER").check();
  await t.getByTestId("targeting-origin-default").selectOption("CASTER");
  await t.getByTestId("targeting-placement").selectOption("FROM_ORIGIN");
  await t.getByTestId("targeting-line-of-sight").selectOption("NOT_REQUIRED");
  await t.getByTestId("targeting-line-of-effect").selectOption("REQUIRED");
  await t.getByTestId("targeting-cover").selectOption("EXPOSED_TO_RESOLUTION");
  await t.getByTestId("targeting-cost-add").click();
  await t.getByTestId("targeting-cost-0-amount").fill("4");
  await t.getByTestId("targeting-cost-add").click();
  await t.getByTestId("targeting-cost-1-amount").fill("2");
  const ember = await createDraft(page, request, ring);
  expect(ember.payload.rules.targeting).toMatchObject({ deliveryFamily: "AREA_DELIVERY", cardinality: { kind: "AREA" }, range: { model: "SELF" }, radiusCapable: true, parameters: [{ parameter: "sizeSteps", kind: "STEPS", minimum: 0, default: 0 }] });
  const formula = ember.payload.rules.targeting.measures[0].formula;
  expect(formula.variables).toEqual([{ variable: "size_steps", source: { kind: "PARAMETER", parameter: "sizeSteps" } }]);
  expect(formula.expression).toBe("10 + 5 * size_steps");
  expect(ember.payload.costContributions.map((c: { data: unknown }) => c.data)).toEqual([{ kind: "BASE", amount: 4 }, { kind: "PER_STEP", parameter: "sizeSteps", amount: 2, step: { size: 5, unit: "ft" } }]);

  // ---- Steady Breath (Casting Condition) ----
  const breath = `Steady Breath E2E ${world.tag}`;
  await newDefinition(page, "SPELL", "SPELL_CASTING_CONDITION", breath);
  const k = page.getByTestId("condition-mechanics");
  await k.getByTestId("condition-restriction").fill("Steady breath");
  await k.getByTestId("condition-applicability-0-fact").selectOption("mechanic.area");
  await k.getByTestId("condition-runtime-add").click();
  await k.getByTestId("condition-runtime-0-name").fill("Breath held");
  await k.getByTestId("condition-runtime-0-fact").fill("can hold breath");
  await k.getByTestId("condition-cost-add").click();
  await k.getByTestId("condition-cost-0-meaning").selectOption("MP_PERCENT_REDUCTION");
  await k.getByTestId("condition-cost-0-amount").fill("10");
  const steady = await createDraft(page, request, breath);
  expect(steady.payload.restriction).toEqual({ restrictionKey: "STEADY_BREATH", data: {} });
  expect(steady.payload.rules.condition).toMatchObject({
    applicability: { kind: "NUMERIC_COMPARE", factKey: "mechanic.area", operator: "==", expected: 1 },
    runtimeRequirements: [{ requirementKey: "BREATH_HELD", requirement: { kind: "NUMERIC_COMPARE", factKey: "runtime.canHoldBreath", operator: ">=", expected: 1 }, parameters: [] }],
  });
  expect(steady.payload.costContributions).toEqual([{ contributionKey: "condition.1", currency: "MP", data: { kind: "FIXED", amount: 10, modifier: "MP_PERCENT_REDUCTION" } }]);

  // ---- Publish both (Release 2) ----
  await approve(request, ember.versionId);
  await approve(request, steady.versionId);
  const cs = await post<Id>(request, `/api/rulesets/${world.rulesetId}/change-sets`, {
    name: `Ember Ring ${world.tag}`,
    operations: [
      { operationType: "ADD_ENTITY_TO_MANIFEST", targetEntityId: ember.entityId, toEntityVersionId: ember.versionId },
      { operationType: "ADD_ENTITY_TO_MANIFEST", targetEntityId: steady.entityId, toEntityVersionId: steady.versionId },
    ],
  });
  await post(request, `/api/change-sets/${cs.id}/submit-review`);
  await post(request, `/api/change-sets/${cs.id}/approve`);
  const r2 = await post<Id & { manifestId: string }>(request, `/api/rulesets/${world.rulesetId}/releases`, { baseManifestId: world.r1.manifestId, canonPolicyId: world.policyId, changeSetId: cs.id, versionLabel: "0.2.0" });

  // ---- A Release-2 Character builds a Spell with them; the server evaluates the cost ----
  const c = await completedCharacter(request, { ...world, r1: r2 }, `Ringcaster ${world.tag}`);
  await page.goto(`/characters/${c.id}?view=abilities`);
  await page.getByTestId("abilities-new-spell").click();
  await page.getByTestId("spell-new-name").fill("Ring of Embers");
  await page.getByTestId("spell-new-start").click();
  await page.getByTestId("spell-step-AUTHORITY").click();
  await page.getByTestId("spell-authority-ARCANE_AUTHORITY").check();
  await page.getByTestId("spell-step-TARGETING").click();
  await page.getByTestId("spell-targeting-picker").getByTestId("spell-option").filter({ hasText: ring }).getByRole("radio").check();
  await page.getByTestId("spell-step-EFFECTS").click();
  await page.getByTestId("spell-effect-picker").getByTestId("spell-option").filter({ hasText: "Detect Mana" }).getByTestId("spell-option-add").click();
  await expect(page.getByTestId("spell-effect")).toHaveCount(1);
  await page.getByTestId("spell-step-DURATION").click();
  await page.getByTestId("spell-duration-picker").getByTestId("spell-option").filter({ hasText: "Instant" }).getByRole("radio").check();
  await expect(page.getByTestId("spell-save-state")).toHaveAttribute("data-save", "saved", { timeout: 20_000 });
  await expect(page.getByTestId("spell-live").getByTestId("spell-state")).toHaveAttribute("data-state", "VALID");
  expect((await evaluationOf(request, c.id)).cost!.finalMpCost).toBe(6); // 4 (Ember Ring) + 2 (Detect Mana)
  await expect(page.getByTestId("spell-live").getByTestId("spell-final-mp")).toHaveText("6 MP");

  // One size step: the radius grows by 5 ft and the server adds 2 MP.
  await page.getByTestId("spell-step-TARGETING").click();
  await page.getByTestId("spell-parameter-sizeSteps").fill("1");
  await expect(page.getByTestId("spell-save-state")).toHaveAttribute("data-save", "saved", { timeout: 20_000 });
  await expect(page.getByTestId("spell-live").getByTestId("spell-final-mp")).toHaveText("8 MP");
  const stepped = await evaluationOf(request, c.id);
  expect(stepped.cost!.finalMpCost).toBe(8);

  // Steady Breath applies (the Spell affects an area): the server lists the 10% reduction and applies it within the cap.
  await page.getByTestId("spell-step-CASTING_CONDITIONS").click();
  await page.getByTestId("spell-condition-picker").getByTestId("spell-option").filter({ hasText: breath }).getByTestId("spell-option-add").click();
  await expect(page.getByTestId("spell-condition")).toHaveCount(1);
  await expect(page.getByTestId("spell-save-state")).toHaveAttribute("data-save", "saved", { timeout: 20_000 });
  await expect(page.getByTestId("spell-live").getByTestId("spell-state")).toHaveAttribute("data-state", "VALID");
  const conditioned = await evaluationOf(request, c.id);
  expect(conditioned.cost!.castingConditions.listedPercent).toBe(10);
  expect(conditioned.cost!.castingConditions.effectivePercent).toBeGreaterThan(0);
  expect(conditioned.cost!.finalMpCost).toBeLessThan(stepped.cost!.finalMpCost);
  await expect(page.getByText(/Listed reduction 10%/)).toBeVisible();
});

test("RULES-WO1 P13 a Duration, a Maneuver Condition and a Foundation are authored in game language and stored in their M5 contracts (R18)", async ({ page, request }) => {
  test.setTimeout(420_000);
  // A Scene Spell Duration with no listed cost.
  const scene = `Lingering Scene E2E ${world.tag}`;
  await newDefinition(page, "SPELL", "SPELL_DURATION", scene);
  await page.getByTestId("duration-concept").selectOption("SCENE");
  const d = await createDraft(page, request, scene);
  expect(d.payload.durationConcept).toBe("SCENE");
  expect(d.payload.rules.duration).toMatchObject({ branch: "SPELL", availability: "EXECUTABLE", costStatus: "UNLISTED", futureRuntime: { sustain: false, manaLock: false, concentration: "NONE", persists: true } });

  // An AP-or-MP Maneuver Condition: the user picks one benefit.
  const first = `Charge First E2E ${world.tag}`;
  await newDefinition(page, "MANEUVER", "MANEUVER_CONDITION", first);
  const k = page.getByTestId("condition-mechanics");
  await k.getByTestId("condition-restriction").fill("Charge first");
  await k.getByTestId("condition-runtime-add").click();
  await k.getByTestId("condition-runtime-0-name").fill("Move ten feet first");
  await k.getByTestId("condition-runtime-0-fact").fill("feet moved before");
  await k.getByTestId("condition-runtime-0-expected").fill("10");
  await k.getByTestId("condition-parameter-add").click();
  await k.getByTestId("condition-parameter-0-name").fill("Benefit");
  await k.getByTestId("condition-parameter-0-type-list").check();
  for (const o of ["AP", "MP"]) {
    await k.getByTestId("condition-parameter-0-options-new").fill(o);
    await k.getByTestId("condition-parameter-0-options-add").click();
  }
  await k.getByTestId("condition-choose-one").check();
  await k.getByTestId("condition-cost-add").click();
  await k.getByTestId("condition-cost-0-meaning").selectOption("AP_REDUCTION");
  await k.getByTestId("condition-cost-0-amount").fill("1");
  await k.getByTestId("condition-cost-0-option").selectOption("AP");
  await k.getByTestId("condition-cost-add").click();
  await k.getByTestId("condition-cost-1-meaning").selectOption("MP_REDUCTION");
  await k.getByTestId("condition-cost-1-amount").fill("2");
  await k.getByTestId("condition-cost-1-option").selectOption("MP");
  const m = await createDraft(page, request, first);
  expect(m.payload.rules.condition.choice).toEqual({ kind: "CHOOSE_ONE", parameter: "benefit" });
  expect(m.payload.costContributions.map((c: { currency: string; data: { modifier: string; option: string } }) => [c.currency, c.data.modifier, c.data.option])).toEqual([
    ["AP", "AP_REDUCTION", "AP"],
    ["MP", "MP_REDUCTION", "MP"],
  ]);

  // A Maneuver Targeting for the performer alone (no cost of its own: the Maneuver owns its AP / MP).
  const self = `Own Footing E2E ${world.tag}`;
  await newDefinition(page, "MANEUVER", "MANEUVER_TARGETING", self);
  await page.getByLabel(/Semantic shape/).selectOption("SELF");
  const t = page.getByTestId("targeting-mechanics");
  await expect(t.getByTestId("targeting-maneuver-cost")).toBeVisible();
  await t.getByTestId("targeting-delivery-family").selectOption("SELF_DELIVERY");
  await t.getByTestId("targeting-cardinality-one").check();
  await t.getByTestId("targeting-target-SELF").check();
  await t.getByTestId("targeting-range-model").selectOption("SELF");
  await t.getByTestId("targeting-origin-PERFORMER").check();
  await t.getByTestId("targeting-origin-default").selectOption("PERFORMER");
  await t.getByTestId("targeting-placement").selectOption("NONE");
  await t.getByTestId("targeting-line-of-sight").selectOption("NOT_REQUIRED");
  await t.getByTestId("targeting-line-of-effect").selectOption("NOT_REQUIRED");
  await t.getByTestId("targeting-cover").selectOption("NOT_APPLICABLE");
  const own = await createDraft(page, request, self);
  expect(own.payload.costContributions).toEqual([]);
  expect(own.payload.rules.targeting).toMatchObject({ deliveryFamily: "SELF_DELIVERY", cardinality: { kind: "ONE" }, validTargets: ["SELF"], range: { model: "SELF" }, radiusCapable: false });

  // A movement Foundation bound to that exact Maneuver Targeting, costing 1 AP.
  const dash = `Quick Dash E2E ${world.tag}`;
  await newDefinition(page, "MANEUVER", "MANEUVER_FOUNDATION", dash);
  const f = page.getByTestId("foundation-mechanics");
  await f.getByTestId("foundation-kind").fill("Action");
  await f.getByTestId("foundation-action-category").selectOption("MOVEMENT");
  const picker = f.getByTestId("foundation-action-targeting");
  await picker.getByRole("button", { name: /Choose|Change/ }).click();
  await picker.getByRole("searchbox").fill("Own Footing");
  await picker.getByRole("button", { name: new RegExp(self) }).first().click();
  await f.getByTestId("foundation-cost-add").click();
  await f.getByTestId("foundation-cost-0-currency").selectOption("AP");
  await f.getByTestId("foundation-cost-0-amount").fill("1");
  const fd = await createDraft(page, request, dash);
  expect(fd.payload.foundationKind).toBe("ACTION");
  expect(fd.payload.rules.action).toMatchObject({ category: "MOVEMENT", targeting: { componentKey: "targeting", definition: { definitionKind: "MANEUVER_TARGETING", entityVersionId: own.versionId }, parameters: {} } });
  expect(fd.payload.costContributions).toEqual([{ contributionKey: "foundation.1", currency: "AP", data: { kind: "FIXED", amount: 1 } }]);
});
