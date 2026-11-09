import { expect as baseExpect, test, type Browser, type Page } from "@playwright/test";
import "./m6-wo8-fixture-loader";
import "./m6-wo11-fixture-loader";

/**
 * PAS-10 M6-WO12 — the playtest slice's FAILURE CASES, deliberately separate from the primary journey
 * (m6-playtest.spec.ts). Setup here may use the approved @prowess/db test fixtures and services (test-only
 * `test.m6wo12f.*` content); every behaviour under test is exercised through the real Studio UI and API against
 * PostgreSQL. One test (F4) intercepts a single response to simulate a LOST commit acknowledgement: the request still
 * reaches the real server, only its reply is dropped — this is never used by the primary journey.
 *
 *   F1 a newer Release exists          F2 draft / invalid / retired abilities
 *   F3 missing roll, invalid roll, insufficient resources, wrong timing
 *   F4 a lost commit response and its idempotent retry
 *   F5 two tabs and same-name Characters
 * Every refusal is checked for a human-readable sentence (F6) and for writing nothing.
 */
type Db = typeof import("@prowess/db");
type World = { readonly rulesetId: string; readonly policyId: string; readonly release: { readonly id: string; readonly manifestId: string; readonly releaseNumber: number }; readonly pins: Map<string, { readonly entityId: string; readonly entityVersionId: string }> };
interface Fixtures {
  seedCharacterRelease(prefix: string, label: string, options: object): Promise<World>;
  publishNextRelease(w: World, keys: readonly string[], label: string, overrides?: Record<string, unknown>): Promise<World>;
  cleanupCharacterWorlds(prefix: string): Promise<void>;
  refOf(pins: World["pins"], key: string): unknown;
}
interface Maneuvers {
  martialCharacter(w: World, name: string): Promise<{ character: { id: string }; attack: unknown }>;
  spellDraft(w: World, name: string): unknown;
}
const runtimeImport = (specifier: string): Promise<unknown> => import(specifier);
const expect = baseExpect.configure({ timeout: 30_000 });
const PREFIX = "test.m6wo12f";
const TAG = `F${Date.now().toString(36)}`;
let db: Db;
let fx: Fixtures;
let mx: Maneuvers;
let r1: World;
let r2: World;
const ids = { veteran: "", fresh: "", twinA: "", twinB: "", spellWard: "", spellDraft: "", spellRetired: "", bolt: "" };

// One worker, in order, sharing one seeded world; a failure does not skip the remaining cases.
test.describe.configure({ mode: "default", timeout: 300_000 });

async function fresh(browser: Browser): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  return { page, close: () => context.close() };
}
const resource = (page: Page, key: string) => page.getByTestId(`play-resource-${key}`);
async function timing(page: Page, event: string) {
  const before = await page.getByTestId("play-workspace").getAttribute("data-runtime-version");
  await page.getByTestId(`play-timing-${event}`).click();
  await expect(page.getByTestId("play-workspace")).not.toHaveAttribute("data-runtime-version", before ?? "");
}
async function openPlay(page: Page, id: string) {
  await page.goto(`/characters/${id}/play`);
  await expect(page.getByTestId("play-workspace")).toBeVisible({ timeout: 60_000 });
}
const witness = async (id: string) => JSON.stringify({ runtime: await db.prisma.characterPlayRuntime.findUnique({ where: { characterId: id } }), events: await db.prisma.characterPlayEvent.findMany({ where: { characterId: id }, orderBy: { sequence: "asc" } }), resources: await db.prisma.characterResourceState.findMany({ where: { characterId: id }, orderBy: { resourceKey: "asc" } }), play: await db.prisma.characterPlayState.findUnique({ where: { characterId: id } }) });
/** A refusal must explain itself in words, not only by a code. */
function humanReadable(text: string | null) {
  expect(text).not.toBeNull();
  const words = text!.replace(/\b[A-Z_]+\.[A-Z_.]+\b/g, "").trim();
  expect(words).toMatch(/[a-z]{3,} [a-z]{2,}/);
}

test.beforeAll(async () => {
  test.setTimeout(900_000);
  db = await import("@prowess/db");
  db.assertRunningAgainstTestDatabase(process.env.DATABASE_URL as string);
  fx = (await runtimeImport("../../../../packages/prowess-db/tests/fixtures/m6-wo3-character-release")) as Fixtures;
  mx = (await runtimeImport("../../../../packages/prowess-db/tests/fixtures/m6-wo8-maneuvers")) as Maneuvers;
  await fx.cleanupCharacterWorlds(PREFIX);
  r1 = await fx.seedCharacterRelease(PREFIX, "R1", { advancement: true, weapons: true, spells: true, maneuvers: true, rulesetName: `M6-WO12 Failures ${TAG}` });
  const veteran = await mx.martialCharacter(r1, `${TAG} Veteran`);
  ids.veteran = veteran.character.id;
  const cid = ids.veteran;
  const ward = { ...(mx.spellDraft(r1, `${TAG} Ward`) as object), targeting: { definition: fx.refOf(r1.pins, "spell.targeting.self"), parameters: {} }, effects: [{ componentKey: "effect1", order: 1, definition: fx.refOf(r1.pins, "fixture.wo9.effect.maintenance"), parameters: { amount: 1 } }], duration: { definition: fx.refOf(r1.pins, "spell.duration.sustained"), parameters: {} } };
  const finalize = async (name: string, draft: unknown, owner = cid) => {
    const s0 = await db.createCharacterSignatureSpell(owner, { name });
    const s1 = await db.updateCharacterSignatureSpellDraft(owner, s0.spell.id, { expectedVersion: s0.spell.lockVersion, draft: draft as never });
    return (await db.finalizeCharacterSignatureSpell(owner, s1.spell.id, { expectedVersion: s1.spell.lockVersion })).spell;
  };
  ids.spellWard = (await finalize(`${TAG} Ward`, ward)).id;
  ids.bolt = (await finalize(`${TAG} Bolt`, mx.spellDraft(r1, `${TAG} Bolt`))).id;
  const retired = await finalize(`${TAG} Old Charm`, { ...ward, concept: { ...(ward as unknown as { concept: object }).concept, name: `${TAG} Old Charm` } });
  ids.spellRetired = (await db.retireCharacterSignatureSpell(cid, retired.id, { expectedVersion: retired.lockVersion })).spell.id;
  ids.spellDraft = (await db.createCharacterSignatureSpell(cid, { name: `${TAG} Unfinished` })).spell.id;
  // F1 — a NEWER Release revises the ward's Effect (MP 4 → 2) after the Veteran was built on Release 1.
  const payload = (await db.prisma.entityVersion.findUniqueOrThrow({ where: { id: r1.pins.get("fixture.wo9.effect.maintenance")!.entityVersionId } })).structuredData as { prowessDefinition: { payload: { costContributions: Array<{ data: object }> } } };
  const revised = structuredClone(payload.prowessDefinition.payload);
  revised.costContributions = [{ ...(revised.costContributions[0] as object), data: { amount: 2, kind: "FIXED" } }] as never;
  r2 = await fx.publishNextRelease(r1, ["fixture.wo9.effect.maintenance"], "R2", { "fixture.wo9.effect.maintenance": revised });
  // F5 — two Characters with the same name on the same Release.
  ids.twinA = (await mx.martialCharacter(r1, `${TAG} Twin`)).character.id;
  ids.twinB = (await mx.martialCharacter(r1, `${TAG} Twin`)).character.id;
  ids.fresh = (await mx.martialCharacter(r1, `${TAG} Fresh`)).character.id;
  await finalize(`${TAG} Fresh Bolt`, mx.spellDraft(r1, `${TAG} Fresh Bolt`), ids.fresh); // an Attack-Roll Spell (F3 missing roll)
});
test.afterAll(async () => {
  test.setTimeout(300_000);
  if (fx !== undefined) await fx.cleanupCharacterWorlds(PREFIX);
});

test("F1 a newer Release exists: the Character, its Spell price and its play stay on the pinned Release; creation never defaults to the latest", async ({ browser }) => {
  const { page, close } = await fresh(browser);
  expect(r2.release.releaseNumber).toBe(2);
  await page.goto("/characters");
  await page.getByTestId("library-search").fill(`${TAG} Veteran`);
  await expect(page.locator(`[data-testid="character-row"][data-character-id="${ids.veteran}"]`)).toContainText("Release 1");
  await page.goto(`/characters/${ids.veteran}/spells/${ids.spellWard}`);
  await expect(page.getByTestId("spell-detail").getByTestId("spell-final-mp").first()).toHaveText("4 MP", { timeout: 60_000 });
  const links = await page.getByTestId("spell-component-link").evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
  expect(links.every((h) => h.includes(`/releases/${r1.release.id}/`))).toBe(true);
  // Play prices the cast from the pinned Release (4 MP), never the newer one (2 MP).
  await openPlay(page, ids.veteran);
  for (const e of ["BEGIN_COMBAT", "START_ROUND", "START_TURN"]) await timing(page, e);
  await page.getByTestId("play-tab-spells").click();
  await expect(page.getByTestId("play-spell").filter({ hasText: `${TAG} Ward` })).toContainText("4 MP");
  // New Character: the Release is an explicit choice listing both; nothing is preselected.
  await page.goto("/characters/new");
  await page.getByRole("combobox", { name: "Ruleset", exact: true }).selectOption({ label: `M6-WO12 Failures ${TAG}` });
  const release = page.getByRole("combobox", { name: "Release", exact: true });
  await expect(release.locator("option", { hasText: "Release 2" })).toBeAttached();
  await expect(release.locator("option", { hasText: "Release 1" })).toBeAttached();
  expect([r1.release.id, r2.release.id]).not.toContain(await release.inputValue());
  expect((await db.prisma.character.findUniqueOrThrow({ where: { id: ids.veteran } })).rulesetReleaseId).toBe(r1.release.id);
  await close();
});

test("F2 draft, invalid and retired Signature Abilities cannot be cast; the refusal explains itself and writes nothing", async ({ browser, request }) => {
  const { page, close } = await fresh(browser);
  await openPlay(page, ids.veteran);
  await page.getByTestId("play-tab-spells").click();
  const names = await page.getByTestId("play-spell").allTextContents();
  expect(names.some((n) => n.includes(`${TAG} Unfinished`))).toBe(false); // a draft is never offered for play
  expect(names.some((n) => n.includes(`${TAG} Old Charm`))).toBe(false); // nor a retired ability
  const before = await witness(ids.veteran);
  const view = (await (await request.get(`/api/characters/${ids.veteran}/play`)).json()).data as { versions: { runtimeVersion: number; playStateVersion: number } };
  for (const abilityId of [ids.spellDraft, ids.spellRetired]) {
    const r = await request.post(`/api/characters/${ids.veteran}/play/operations`, { data: { operation: { kind: "SPELL", abilityId, revisionNumber: 1, targets: [{ targetKey: "self" }], inputs: [] }, idempotencyKey: crypto.randomUUID(), expectedRuntimeVersion: view.versions.runtimeVersion, expectedPlayStateVersion: view.versions.playStateVersion } });
    const body = (await r.json()) as { data?: { committed: boolean; outcome: { status: string; summary: string } }; message?: string };
    const refused = r.status() >= 400 || body.data?.committed === false;
    expect(refused).toBe(true);
    humanReadable(body.message ?? body.data?.outcome.summary ?? null);
  }
  // A substituted revision number for a live ability is refused too (no silent fallback to the current revision).
  const r = await request.post(`/api/characters/${ids.veteran}/play/operations`, { data: { operation: { kind: "SPELL", abilityId: ids.spellWard, revisionNumber: 2, targets: [{ targetKey: "self" }], inputs: [] }, idempotencyKey: crypto.randomUUID(), expectedRuntimeVersion: view.versions.runtimeVersion, expectedPlayStateVersion: view.versions.playStateVersion } });
  const body = (await r.json()) as { data?: { committed: boolean; outcome: { summary: string } }; message?: string };
  expect(r.status() >= 400 || body.data?.committed === false).toBe(true);
  humanReadable(body.message ?? body.data?.outcome.summary ?? null);
  expect(await witness(ids.veteran)).toBe(before);
  await close();
});

test("F3 wrong timing, an invalid raw roll, a missing roll and insufficient resources are refused with nothing paid", async ({ browser }) => {
  const { page, close } = await fresh(browser);
  await openPlay(page, ids.fresh);
  // Wrong timing: outside the Character's turn every turn Action is unavailable, with the reason.
  const move = page.locator('[data-action="MOVE"]');
  await expect(move).toContainText("start the turn first");
  for (const e of ["BEGIN_COMBAT", "START_ROUND", "START_TURN"]) await timing(page, e);
  const apMax = (await resource(page, "AP").textContent())!.trim();
  // An out-of-range raw roll for a d4 Character Die.
  await page.getByTestId("play-tab-attacks").click();
  await page.getByTestId("play-attack").filter({ hasText: "Slash" }).first().getByTestId("play-attack-open").click();
  await page.getByTestId("play-attack-roll-face-0").fill("9");
  await page.getByTestId("play-attack-dodge").fill("3");
  const before = await witness(ids.fresh);
  await page.getByTestId("play-commit").click();
  await expect(page.getByTestId("play-result")).toHaveAttribute("data-status", "REFUSED");
  await expect(page.getByTestId("play-result")).toContainText("the roll is not valid for the Character Die");
  expect(await witness(ids.fresh)).toBe(before);
  await expect(resource(page, "AP")).toHaveText(apMax);
  // A missing roll: the Spell's Attack Roll is asked for, and nothing is paid until it is answered.
  await page.getByTestId("play-tab-spells").click();
  await page.getByTestId("play-spell").first().getByTestId("play-ability-open").click();
  await page.getByTestId("play-commit").click();
  await expect(page.getByTestId("play-pending").first()).toBeVisible();
  await expect(page.getByTestId("play-result")).toHaveAttribute("data-committed", "false");
  expect(await witness(ids.fresh)).toBe(before);
  // Insufficient resources: four Slam-sized costs cannot fit one turn's AP.
  await page.getByTestId("play-tab-attacks").click();
  const heavy = page.getByTestId("play-attack").filter({ hasText: "Slash" }).first();
  for (let i = 0; i < 2; i += 1) {
    await heavy.getByTestId("play-attack-open").click();
    await page.getByTestId("play-attack-roll-face-0").fill("3");
    await page.getByTestId("play-attack-dodge").fill("3");
    await page.getByTestId("play-commit").click();
    await expect(page.getByTestId("play-result")).toHaveAttribute("data-committed", "true");
  }
  await expect(resource(page, "AP")).toHaveText(apMax.replace(/^\d+/, "0"));
  const spent = await witness(ids.fresh);
  await page.getByTestId("play-tab-attacks").click();
  await heavy.getByTestId("play-attack-open").click();
  await page.getByTestId("play-attack-roll-face-0").fill("3");
  await page.getByTestId("play-attack-dodge").fill("3");
  await page.getByTestId("play-commit").click();
  await expect(page.getByTestId("play-result")).not.toHaveAttribute("data-committed", "true");
  humanReadable(await page.getByTestId("play-result").innerText());
  expect(await witness(ids.fresh)).toBe(spent);
  await close();
});

test("F4 a lost commit response: the retry reuses the request key, the server replays the original event, and nothing is paid twice", async ({ browser }) => {
  const { page, close } = await fresh(browser);
  await openPlay(page, ids.twinA);
  for (const e of ["BEGIN_COMBAT", "START_ROUND", "START_TURN"]) await timing(page, e);
  const apBefore = (await resource(page, "AP").textContent())!.trim();
  const eventsBefore = await db.prisma.characterPlayEvent.count({ where: { characterId: ids.twinA } });
  let dropped = 0;
  await page.route(`**/api/characters/${ids.twinA}/play/operations`, async (route) => {
    if (dropped === 0) {
      dropped += 1;
      await route.fetch(); // the REAL server receives and commits the request …
      return route.abort("connectionreset"); // … but its acknowledgement never reaches the browser
    }
    return route.continue();
  });
  await page.locator('[data-action="MOVE"] [data-testid="play-action-open"]').click();
  await page.getByTestId("play-commit").click();
  await expect(page.getByTestId("play-notice")).toContainText("submit again to retry safely with the same request key");
  await expect(resource(page, "AP")).toHaveText(apBefore); // nothing is shown as spent before the server confirms
  await page.getByTestId("play-commit").click();
  await expect(page.getByTestId("play-notice")).toContainText("already committed");
  const events = await db.prisma.characterPlayEvent.findMany({ where: { characterId: ids.twinA }, orderBy: { sequence: "asc" } });
  expect(events.length).toBe(eventsBefore + 1);
  expect(events.filter((e) => e.operationKind === "GENERAL_ACTION")).toHaveLength(1);
  const ap = Number(apBefore.split("/")[0]);
  await expect(resource(page, "AP")).toHaveText(apBefore.replace(/^\d+/, String(ap - 1)));
  await close();
});

test("F5 two tabs: a stale tab is refused and reloaded; same-name Characters are told apart and keep their own play state", async ({ browser }) => {
  const a = await fresh(browser);
  const b = await fresh(browser);
  for (const t of [a, b]) await openPlay(t.page, ids.twinB);
  await timing(a.page, "BEGIN_COMBAT");
  const before = await witness(ids.twinB);
  await b.page.getByTestId("play-timing-BEGIN_COMBAT").click();
  await expect(b.page.getByTestId("play-notice")).toContainText("changed elsewhere");
  humanReadable(await b.page.getByTestId("play-notice").textContent());
  expect(await witness(ids.twinB)).toBe(before); // nothing applied by the stale tab
  await expect(b.page.getByTestId("play-workspace")).toHaveAttribute("data-runtime-version", (await a.page.getByTestId("play-workspace").getAttribute("data-runtime-version"))!);
  // Same-name Characters: two rows, two short ids, two separate play histories.
  await a.page.goto("/characters");
  await a.page.getByTestId("library-search").fill(`${TAG} Twin`);
  await expect(a.page.getByTestId("character-row")).toHaveCount(2);
  const shorts = await a.page.getByTestId("library-character-id").allTextContents();
  expect(new Set(shorts).size).toBe(2);
  const counts = await Promise.all([ids.twinA, ids.twinB].map((id) => db.prisma.characterPlayEvent.count({ where: { characterId: id } })));
  expect(counts[0]).not.toBe(counts[1]);
  await a.close();
  await b.close();
});
