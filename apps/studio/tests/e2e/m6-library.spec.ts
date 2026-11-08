import { expect, test, type Browser, type Page } from "@playwright/test";
import "./m6-wo8-fixture-loader";
import "./m6-wo11-fixture-loader";

/**
 * PAS-10 M6-WO11 — Character Library / Save / Load in a real browser against the production build and
 * prowess_studio_test (acceptance L02 L03 L04 L05 L07). The Release, its Characters, their loadout, Signature Abilities
 * and play history are created through the REAL @prowess/db services (the approved PostgreSQL test fixtures, test-only
 * `test.m6wo11e2e.*` keys — never canon); everything the player does here goes through the real Studio UI and API.
 * Every "fresh session" is a genuinely new browser context (no cookies, storage or cache from the previous one).
 */
type Db = typeof import("@prowess/db");
// The approved PostgreSQL test fixtures are loaded at run time (their source imports are not part of Studio's type graph).
type World = { readonly rulesetId: string; readonly release: { readonly id: string }; readonly pins: Map<string, { readonly entityVersionId: string }> };
interface Fixtures {
  seedCharacterRelease(prefix: string, label: string, options: object): Promise<World>;
  cleanupCharacterWorlds(prefix: string): Promise<void>;
  workedChoices(pins: World["pins"]): unknown;
  refOf(pins: World["pins"], key: string): unknown;
}
interface Maneuvers {
  martialCharacter(w: World, name: string): Promise<{ character: { id: string }; attack: unknown }>;
  spellDraft(w: World, name: string): unknown;
  maneuverDraft(w: World, attack: unknown, name: string): unknown;
}
const runtimeImport = (specifier: string): Promise<unknown> => import(specifier);
const PREFIX = "test.m6wo11e2e";
const TAG = `Wlib${Date.now().toString(36)}`;
let db: Db;
let fx: Fixtures;
let mx: Maneuvers;
let world: World;
const ids = { twinBlade: "", twinBare: "", configured: "", spell: "", maneuver: "", stale: "" };
let rulesetName = "";
let longBlade = "";

test.describe.configure({ mode: "serial" });

async function fresh(browser: Browser): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  return { page, close: () => context.close() };
}
async function findInLibrary(page: Page, search: string) {
  await page.goto("/characters");
  await page.getByTestId("library-search").fill(search);
  await expect(page.getByTestId("library-total")).toContainText("match");
  return page.getByTestId("character-row");
}
async function commit(id: string, operation: unknown) {
  const v = (await db.getCharacterPlayWorkspace(id)).versions;
  const out = await db.commitCharacterPlayOperation(id, { operation, idempotencyKey: crypto.randomUUID(), expectedRuntimeVersion: v.runtimeVersion, expectedPlayStateVersion: v.playStateVersion });
  return out;
}

test.beforeAll(async () => {
  test.setTimeout(1_200_000);
  db = await import("@prowess/db");
  fx = (await runtimeImport("../../../../packages/prowess-db/tests/fixtures/m6-wo3-character-release")) as Fixtures;
  mx = (await runtimeImport("../../../../packages/prowess-db/tests/fixtures/m6-wo8-maneuvers")) as Maneuvers;
  db.assertRunningAgainstTestDatabase(process.env.DATABASE_URL as string);
  await fx.cleanupCharacterWorlds(PREFIX);
  world = await fx.seedCharacterRelease(PREFIX, "R1", { advancement: true, weapons: true, spells: true, maneuvers: true });
  rulesetName = (await db.prisma.ruleset.findUniqueOrThrow({ where: { id: world.rulesetId } })).name;
  longBlade = world.pins.get("weapon.long_blade")!.entityVersionId;

  // L02 — two Characters with the same name, Level and Release; different saved loadouts.
  const blade = await mx.martialCharacter(world, `${TAG} Twin`);
  ids.twinBlade = blade.character.id;
  const bare = await db.createCharacter({ name: `${TAG} Twin`, rulesetReleaseId: world.release.id });
  const saved = await db.saveCharacterCreation(bare.id, { expectedLockVersion: bare.lockVersion, candidate: fx.workedChoices(world.pins) as never });
  ids.twinBare = (await db.finalizeCharacterCoreCreation(bare.id, { expectedLockVersion: saved.lockVersion })).id;

  // L04 / L05 — a configured Character: loadout, a Signature Spell and a Signature Maneuver, then a legal WO10 sequence.
  const { character, attack } = await mx.martialCharacter(world, `${TAG} Configured`);
  ids.configured = character.id;
  const s0 = await db.createCharacterSignatureSpell(character.id, { name: `${TAG} Bolt` });
  const s1 = await db.updateCharacterSignatureSpellDraft(character.id, s0.spell.id, { expectedVersion: s0.spell.lockVersion, draft: mx.spellDraft(world, `${TAG} Bolt`) as never });
  ids.spell = (await db.finalizeCharacterSignatureSpell(character.id, s1.spell.id, { expectedVersion: s1.spell.lockVersion })).spell.id;
  const m0 = await db.createCharacterSignatureManeuver(character.id, { name: `${TAG} Strike` });
  const m1 = await db.updateCharacterSignatureManeuverDraft(character.id, m0.maneuver.id, { expectedVersion: m0.maneuver.lockVersion, draft: mx.maneuverDraft(world, attack, `${TAG} Strike`) as never });
  ids.maneuver = (await db.finalizeCharacterSignatureManeuver(character.id, m1.maneuver.id, { expectedVersion: m1.maneuver.lockVersion })).maneuver.id;
  // A Sustained Signature Spell (the maintenance-eligible test Effect) that becomes M5-WO13 Active Magic when cast.
  const ward = { ...(mx.spellDraft(world, `${TAG} Ward`) as object), effects: [{ componentKey: "effect1", order: 1, definition: fx.refOf(world.pins, "fixture.wo9.effect.maintenance"), parameters: { amount: 1 } }], duration: { definition: fx.refOf(world.pins, "spell.duration.sustained"), parameters: {} } };
  const w0 = await db.createCharacterSignatureSpell(character.id, { name: `${TAG} Ward` });
  const w1 = await db.updateCharacterSignatureSpellDraft(character.id, w0.spell.id, { expectedVersion: w0.spell.lockVersion, draft: ward as never });
  const wardId = (await db.finalizeCharacterSignatureSpell(character.id, w1.spell.id, { expectedVersion: w1.spell.lockVersion })).spell.id;
  for (const op of [{ kind: "TIMING", event: "BEGIN_COMBAT" }, { kind: "TIMING", event: "START_ROUND" }, { kind: "TIMING", event: "START_TURN" }, { kind: "GENERAL_ACTION", actionKey: "MOVE" }, { kind: "MOVEMENT", segments: [{ distance: 5, terrainKey: "NORMAL" }] }]) expect((await commit(character.id, op)).committed).toBe(true);
  const cast = { kind: "SPELL", abilityId: wardId, revisionNumber: 1, targets: [{ targetKey: "self" }], inputs: [] as unknown[] };
  let out = await commit(character.id, cast);
  if (!out.committed && out.outcome?.status === "PENDING_INPUT") {
    const answers = (out.outcome.pending as Array<{ requestKey: string; kind: string }>).map((q) => (q.kind === "ATTACK_ROLL" ? { requestKey: q.requestKey, kind: "ATTACK_ROLL", roll: { mode: "NORMAL", rolls: [4], source: "PHYSICAL" }, targetDodge: 5 } : { requestKey: q.requestKey, kind: "SAVING_THROW", roll: { mode: "NORMAL", rolls: [1], source: "PHYSICAL" }, defender: { level: 1, stats: { STR: 3, AGI: 3, CON: 3, PER: 3, RES: 3, PRO: 3 } } }));
    out = await commit(character.id, { ...cast, inputs: answers });
  }
  expect(out.committed).toBe(true);

  // L07 — a Draft two tabs will edit.
  ids.stale = (await db.createCharacter({ name: `${TAG} Stale`, rulesetReleaseId: world.release.id })).id;
});
test.afterAll(async () => {
  test.setTimeout(300_000);
  if (fx !== undefined) await fx.cleanupCharacterWorlds(PREFIX);
});

test("L02 same-named Characters are told apart in the Library and each opens its own saved data", async ({ browser }) => {
  const { page, close } = await fresh(browser);
  const rows = await findInLibrary(page, `${TAG} Twin`);
  await expect(rows).toHaveCount(2);
  await expect(page.getByTestId("library-total")).toHaveText("2 Characters match");
  const shortIds = await rows.getByTestId("library-character-id").allTextContents();
  expect(new Set(shortIds).size).toBe(2);
  for (const [id, weapon] of [[ids.twinBlade, longBlade], [ids.twinBare, null]] as const) {
    await findInLibrary(page, `${TAG} Twin`);
    const row = page.locator(`[data-testid="character-row"][data-character-id="${id}"]`);
    await expect(row.getByTestId("library-character-id")).toHaveText(`id ${id.slice(0, 8)}`);
    await row.getByTestId("library-open-sheet").click();
    await page.waitForURL(`**/characters/${id}`);
    if (weapon === null) await expect(page.getByTestId("sheet-main-hand")).toHaveText("None", { timeout: 60_000 });
    else await expect(page.getByTestId("sheet-main-hand")).toHaveAttribute("data-weapon", weapon, { timeout: 60_000 });
  }
  await close();
});

test("L03 a partial Draft saved in one session resumes in a new session, completes through the existing flow, and its Library actions change", async ({ browser }) => {
  const name = `${TAG} Resumed`;
  let id = "";
  {
    const { page, close } = await fresh(browser);
    await page.goto("/characters");
    await page.getByRole("link", { name: "New Character" }).click();
    await page.getByRole("combobox", { name: "Ruleset", exact: true }).selectOption({ label: rulesetName });
    await page.getByRole("combobox", { name: "Release", exact: true }).selectOption(world.release.id);
    await expect(page.getByTestId("capability-ready")).toBeVisible();
    await page.getByLabel("Name (required)").fill(name);
    await page.getByRole("button", { name: "Create Character Draft" }).click();
    await page.waitForURL(/\/characters\/[0-9a-f-]+\/create$/);
    id = page.url().split("/").at(-2)!;
    await page.getByRole("button", { name: "2. Race / Ancestry" }).click();
    await page.getByTestId("ancestry-card").filter({ hasText: "Orcani (test)" }).getByRole("radio").check();
    await page.getByLabel("Stat choice 1 of 2").selectOption("AGI");
    await page.getByLabel("Stat choice 2 of 2").selectOption("PRO");
    await expect(page.getByTestId("wizard-save-state")).toHaveText("Unsaved changes.");
    await page.getByRole("button", { name: "Save & Continue" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Stats" })).toBeVisible();
    await expect(page.getByTestId("wizard-save-state")).toHaveText("All changes saved.");
    // Unsaved Stat edits are never stored: this session ends with one point allocated but not saved.
    await page.getByRole("button", { name: "Add a point to STR" }).click();
    await close();
  }
  {
    const { page, close } = await fresh(browser);
    const rows = await findInLibrary(page, name);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Draft");
    await expect(rows.first().getByTestId("library-resume-play")).toHaveCount(0);
    await rows.first().getByTestId("library-continue-creation").click();
    await page.waitForURL(`**/characters/${id}/create`);
    // Continues where the saved progress needs it: Stats, with nothing spent (the unsaved point did not survive).
    await expect(page.getByRole("heading", { level: 2, name: "Stats" })).toBeVisible();
    await expect(page.getByTestId("points-remaining")).toHaveText("Points Remaining: 15 of 15");
    await page.getByRole("button", { name: "2. Race / Ancestry" }).click();
    await expect(page.getByTestId("ancestry-card").filter({ hasText: "Orcani (test)" }).getByRole("radio")).toBeChecked();
    await expect(page.getByLabel("Stat choice 1 of 2")).toHaveValue("AGI");
    await page.getByRole("button", { name: "3. Stats" }).click();
    for (const [stat, n] of [["STR", 3], ["AGI", 3], ["CON", 3], ["PER", 2], ["RES", 2], ["PRO", 2]] as const) for (let i = 0; i < n; i += 1) await page.getByRole("button", { name: `Add a point to ${stat}` }).click();
    await expect(page.getByTestId("points-remaining")).toHaveText("Points Remaining: 0 of 15");
    await page.getByRole("button", { name: "Save & Continue" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Skills" })).toBeVisible();
    await page.getByLabel("Race Skill 1").selectOption({ label: "Athletics (test)" });
    await page.getByLabel("Free Skill 1").selectOption({ label: "Stealth (test)" });
    await page.getByLabel("Free Skill 2").selectOption({ label: "Arcana (test)" });
    await page.getByRole("button", { name: "Save & Continue" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Primary Affinity" })).toBeVisible();
    await page.getByTestId("affinity-card").filter({ hasText: "Evocation (test)" }).getByRole("radio").check();
    await page.getByRole("button", { name: "Save & Continue" }).click();
    await expect(page.getByTestId("check-ready")).toBeVisible();
    await page.getByRole("button", { name: "Complete Core Creation" }).click();
    await page.waitForURL(`**/characters/${id}`);
    const after = await findInLibrary(page, name);
    await expect(after.first()).toContainText("Core Creation Complete");
    await expect(after.first().getByTestId("library-continue-creation")).toHaveCount(0);
    await expect(after.first().getByTestId("library-open-sheet")).toHaveAttribute("href", `/characters/${id}`);
    await expect(after.first().getByTestId("library-resume-play")).toHaveAttribute("href", `/characters/${id}/play`);
    await close();
  }
});

test("L04 a configured Character reopens from the Library with its loadout, exact ability revisions and Cards", async ({ browser }) => {
  const { page, close } = await fresh(browser);
  const rows = await findInLibrary(page, `${TAG} Configured`);
  await rows.first().getByTestId("library-open-sheet").click();
  await page.waitForURL(`**/characters/${ids.configured}`);
  // The full Sheet (WO5–WO9 projections of a Character with a loadout and three abilities) takes a few seconds.
  await expect(page.getByTestId("sheet-main-hand")).toHaveAttribute("data-weapon", longBlade, { timeout: 60_000 });
  await expect(page.getByTestId("sheet-attack-row").first()).toBeVisible();
  await expect(page.getByTestId("sheet-spell-row").filter({ hasText: `${TAG} Bolt` })).toBeVisible();
  await expect(page.getByTestId("sheet-maneuver-row").filter({ hasText: `${TAG} Strike` })).toContainText("· r1");
  await page.getByTestId("sheet-spell-row").filter({ hasText: `${TAG} Bolt` }).getByTestId("sheet-spell-card").click();
  await page.waitForURL(`**/characters/${ids.configured}/cards?ability=${ids.spell}`);
  await expect(page.getByText(`${TAG} Bolt`).first()).toBeVisible({ timeout: 60_000 });
  await close();
});

test("L05 Resume play twice in fresh sessions: identical spent resources, movement, history and versions; nothing is written", async ({ browser }) => {
  const witness = async () => JSON.stringify({ runtime: await db.prisma.characterPlayRuntime.findUnique({ where: { characterId: ids.configured } }), events: await db.prisma.characterPlayEvent.findMany({ where: { characterId: ids.configured }, orderBy: { sequence: "asc" } }), resources: await db.prisma.characterResourceState.findMany({ where: { characterId: ids.configured }, orderBy: { resourceKey: "asc" } }), play: await db.prisma.characterPlayState.findUnique({ where: { characterId: ids.configured } }), character: await db.prisma.character.findUnique({ where: { id: ids.configured } }) });
  const before = await witness();
  const seen: string[] = [];
  for (let i = 0; i < 2; i += 1) {
    const { page, close } = await fresh(browser);
    const rows = await findInLibrary(page, `${TAG} Configured`);
    await rows.first().getByTestId("library-resume-play").click();
    await page.waitForURL(`**/characters/${ids.configured}/play`);
    const ws = page.getByTestId("play-workspace");
    await expect(ws).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("play-context")).toHaveAttribute("data-turn", "ACTIVE");
    await page.getByTestId("play-tab-movement").click();
    await expect(page.getByTestId("play-movement-segments")).toContainText("5 ft");
    await page.getByTestId("play-tab-magic").click();
    await expect(page.getByTestId("play-effect")).toHaveAttribute("data-status", "ACTIVE");
    seen.push(JSON.stringify({
      runtime: await ws.getAttribute("data-runtime-version"),
      playState: await ws.getAttribute("data-play-state-version"),
      ap: await page.getByTestId("play-resource-AP").textContent(),
      mp: await page.getByTestId("play-resource-MP").textContent(),
      movement: await page.getByTestId("play-resource-MOVEMENT_ALLOWANCE").textContent(),
      events: await page.getByTestId("play-event").allTextContents(),
      magic: await page.getByTestId("play-effect").allTextContents(),
    }));
    await close();
  }
  expect(seen[1]).toBe(seen[0]);
  expect(JSON.parse(seen[0]!).runtime).toBe("6");
  expect(JSON.parse(seen[0]!).events).toHaveLength(6);
  expect(await witness()).toBe(before);
});

test("L07 a stale second tab cannot overwrite the first tab's saved edit; it explains the conflict and reloads explicitly", async ({ browser }) => {
  const a = await fresh(browser);
  const b = await fresh(browser);
  for (const t of [a, b]) {
    await t.page.goto(`/characters/${ids.stale}/create`);
    await expect(t.page.getByTestId("character-wizard")).toBeVisible({ timeout: 60_000 });
  }
  await a.page.getByLabel("Name").fill(`${TAG} Stale A`);
  await a.page.getByRole("button", { name: "Save & Continue" }).click();
  await expect(a.page.getByTestId("wizard-message")).toHaveText("Saved.");
  await b.page.getByLabel("Name").fill(`${TAG} Stale B`);
  await b.page.getByRole("button", { name: "Save & Continue" }).click();
  await expect(b.page.getByTestId("wizard-reload")).toBeVisible();
  await expect(b.page.getByTestId("wizard-save-state")).toHaveText("Unsaved changes.");
  expect((await db.getCharacter(ids.stale)).name).toBe(`${TAG} Stale A`);
  await b.page.getByTestId("wizard-reload").click();
  await expect(b.page.getByLabel("Name")).toHaveValue(`${TAG} Stale A`);
  await expect(b.page.getByTestId("wizard-save-state")).toHaveText("All changes saved.");
  await a.close();
  await b.close();
});
