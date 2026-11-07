import { expect, test, type Page, type Route } from "@playwright/test";
import "./m6-wo8-fixture-loader";
import { sheetFixture } from "../unit/m6-wo5-sheet-fixture";

/**
 * PAS-10 M6-WO10 — real-browser Character Play Workspace flows (verification F). Browser transport fixture only: every
 * response is produced by the REAL @prowess/game play domain over the isolated M6-WO10 test Release, through an
 * in-memory stand-in of the Play Workspace API (tests/unit/m6-wo10-play-world.ts) that keeps state across reloads.
 * Atomic persistence, idempotency and concurrency are proven against PostgreSQL by the DB / API suites. Nothing is
 * published and no canonical Release is touched.
 */
test.describe.configure({ timeout: 300_000 });

async function serve(page: Page) {
  const { FakePlayServer, PLAY_CHARACTER_ID, StaleError, ConflictError } = await import("../unit/m6-wo10-play-world");
  const { cardWorld } = await import("../unit/m6-wo9-card-world");
  const server = new FakePlayServer();
  const id = PLAY_CHARACTER_ID;
  const fail = (route: Route, e: unknown) => {
    if (e instanceof StaleError || e instanceof ConflictError) return route.fulfill({ status: 409, json: { code: e.code, message: e.message } });
    throw e;
  };
  await page.route(`**/api/characters/${id}/play`, (r) => r.fulfill({ json: { data: server.view() } }));
  await page.route(`**/api/characters/${id}/play/preview`, (r) => {
    const b = r.request().postDataJSON() as { operation: unknown; expectedRuntimeVersion: number; expectedPlayStateVersion: number };
    try {
      return r.fulfill({ json: { data: server.preview(b.operation, b.expectedRuntimeVersion, b.expectedPlayStateVersion) } });
    } catch (e) {
      return fail(r, e);
    }
  });
  await page.route(`**/api/characters/${id}/play/operations`, (r) => {
    const b = r.request().postDataJSON() as { operation: unknown; idempotencyKey: string; expectedRuntimeVersion: number; expectedPlayStateVersion: number };
    try {
      return r.fulfill({ json: { data: server.commit(b.operation, b.idempotencyKey, b.expectedRuntimeVersion, b.expectedPlayStateVersion) } });
    } catch (e) {
      return fail(r, e);
    }
  });
  await page.route(`**/api/characters/${id}/cards`, (r) => r.fulfill({ json: { data: cardWorld().library } }));
  const sheet = sheetFixture();
  await page.route(`**/api/characters/${id}/sheet`, (r) => r.fulfill({ json: { data: { ...sheet, identity: { ...sheet.identity, id } } } }));
  await page.route(`**/api/characters/${id}/portrait/image**`, (r) => r.fulfill({ status: 404, json: { code: "NOT_FOUND", message: "none" } }));
  return { server, id };
}

const resource = (page: Page, key: string) => page.getByTestId(`play-resource-${key}`);
async function timing(page: Page, event: string) {
  const before = await page.getByTestId("play-workspace").getAttribute("data-runtime-version");
  await page.getByTestId(`play-timing-${event}`).click();
  await expect(page.getByTestId("play-workspace")).not.toHaveAttribute("data-runtime-version", before ?? "");
}

test.describe("M6-WO10 Character Play Workspace in a real browser", () => {
  test("a full turn: timing, an Action, movement, a Spell with a raw roll, Active Magic, end of turn and reload", async ({ page }) => {
    const { server, id } = await serve(page);
    // 1–2. Open the completed Character's Play Workspace.
    await page.goto(`/characters/${id}/play`);
    await expect(page.getByTestId("play-workspace")).toBeVisible();
    await expect(page.getByTestId("play-header")).toContainText("Play Tester");
    const apMax = server.view().workspace.resources.find((r) => r.resourceKey === "AP")!.maximum!;
    // 3. Begin combat, the round and the turn.
    for (const e of ["BEGIN_COMBAT", "START_ROUND", "START_TURN"]) await timing(page, e);
    await expect(page.getByTestId("play-context")).toHaveAttribute("data-turn", "ACTIVE");
    await expect(resource(page, "AP")).toHaveText(`${apMax} / ${apMax}`);
    // 4–5. A supported General Action (Move) spends its AP only on commit.
    await page.locator('[data-action="MOVE"] [data-testid="play-action-open"]').click();
    await page.getByTestId("play-preview").click();
    await expect(page.getByTestId("play-result")).toHaveAttribute("data-committed", "false");
    await expect(resource(page, "AP")).toHaveText(`${apMax} / ${apMax}`);
    await page.getByTestId("play-commit").click();
    await expect(page.getByTestId("play-result")).toHaveAttribute("data-committed", "true");
    await expect(resource(page, "AP")).toHaveText(`${apMax - 1} / ${apMax}`);
    // 6. Spend the granted Movement Allowance in a difficult-terrain segment.
    await expect(resource(page, "MOVEMENT_ALLOWANCE")).not.toHaveText("0");
    await page.getByTestId("play-tab-movement").click();
    await page.getByTestId("play-movement-open").click();
    await page.getByTestId("play-segment-0-distance").fill("5");
    await page.getByTestId("play-segment-0-terrain").selectOption("DIFFICULT");
    await page.getByTestId("play-commit").click();
    await expect(page.getByTestId("play-result")).toHaveAttribute("data-committed", "true");
    await page.getByTestId("play-tab-movement").click();
    await expect(page.getByTestId("play-movement-segments")).toContainText("5 ft difficult (cost 10)");
    // 7–9. A Spell: the engine's pending Attack Roll, a raw roll, the evaluated result, outcomes NOT applied.
    await page.getByTestId("play-tab-spells").click();
    await page.getByTestId("play-spell").filter({ hasText: "Ember Bolt" }).getByTestId("play-ability-open").click();
    await page.getByTestId("play-commit").click();
    const pending = page.getByTestId("play-pending");
    await expect(pending).toHaveAttribute("data-kind", "ATTACK_ROLL");
    const req = (await pending.getAttribute("data-request"))!.replace(/[^A-Za-z0-9]/g, "_");
    await page.getByTestId(`play-pending-${req}-roll-face-0`).fill("7");
    await page.getByTestId(`play-pending-${req}-dodge`).fill("4");
    await page.getByTestId("play-commit").click();
    await expect(page.getByTestId("play-result")).toHaveAttribute("data-committed", "true");
    await expect(page.getByTestId("play-result-outcomes")).toContainText("not applied");
    // 10. Active Magic: a Sustained Spell activates once and can be dismissed by its pinned rule.
    await page.getByTestId("play-tab-spells").click();
    await page.getByTestId("play-spell").filter({ hasText: "Steady Ward" }).getByTestId("play-ability-open").click();
    await page.getByTestId("play-commit").click();
    await expect(page.getByTestId("play-result")).toHaveAttribute("data-committed", "true");
    await page.getByTestId("play-tab-magic").click();
    await expect(page.getByTestId("play-effect")).toHaveAttribute("data-status", "ACTIVE");
    await expect(page.getByTestId("play-concentration")).toContainText("1 /");
    await page.getByTestId("play-effect-dismiss").click();
    await expect(page.getByTestId("play-effect")).toHaveAttribute("data-status", "ENDED");
    // 11. End of turn: unused AP and Movement Allowance expire by the authored timing.
    await timing(page, "END_TURN");
    await expect(resource(page, "AP")).toHaveText(`0 / ${apMax}`);
    await expect(resource(page, "MOVEMENT_ALLOWANCE")).toHaveText("0");
    // 12. Reload: the committed state is recovered exactly; nothing refreshed or advanced on its own.
    const events = await page.getByTestId("play-event").count();
    await page.reload();
    await expect(page.getByTestId("play-context")).toHaveAttribute("data-turn", "ENDED");
    await expect(resource(page, "AP")).toHaveText(`0 / ${apMax}`);
    await expect(page.getByTestId("play-event")).toHaveCount(events);
    await expect(page.getByTestId("play-log")).toContainText("Ember Bolt cast");
  });

  test("a stale submission after a Character Sheet edit applies nothing; Weapon Attack hits show damage NOT applied", async ({ page }) => {
    const { server, id } = await serve(page);
    await page.goto(`/characters/${id}/play`);
    for (const e of ["BEGIN_COMBAT", "START_ROUND", "START_TURN"]) await timing(page, e);
    // 13. Stale: the sheet changes elsewhere; the Play submission is refused, reloaded and explained.
    server.sheetEdit("HP", 3);
    await page.getByTestId("play-timing-END_TURN").click();
    await expect(page.getByTestId("play-notice")).toContainText("changed elsewhere");
    await expect(resource(page, "HP")).toContainText("3 /");
    await expect(page.getByTestId("play-context")).toHaveAttribute("data-turn", "ACTIVE");
    // A Weapon Attack: its own AP, a GM-provided Dodge, the server's Attack Roll, damage authorised but never applied.
    await page.getByTestId("play-tab-attacks").click();
    await page.locator('[data-testid="play-attack"][data-availability="AVAILABLE"] [data-testid="play-attack-open"]').first().click();
    await page.getByTestId("play-attack-roll-face-0").fill("8");
    await page.getByTestId("play-attack-dodge").fill("5");
    await page.getByTestId("play-commit").click();
    await expect(page.getByTestId("play-result-check")).toContainText("hit");
    await expect(page.getByTestId("play-result-outcome")).toContainText("NOT APPLIED");
  });

  test("14–15. the related WO9 card opens read-only; the Character Sheet and Card print still render", async ({ page }) => {
    const { id } = await serve(page);
    await page.goto(`/characters/${id}/play`);
    await page.locator('[data-action="DODGE_ACTION"] [data-testid="play-open-card"]').click();
    await expect(page.getByTestId("play-card-drawer")).toBeVisible();
    await expect(page.getByTestId("play-card-drawer").getByTestId("play-commit")).toHaveCount(0);
    await page.getByTestId("play-card-close").click();
    await expect(page.getByTestId("play-card-drawer")).toHaveCount(0);
    // Keyboard: the category tabs are reachable and move with the arrow keys.
    await page.getByTestId("play-tab-general").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("play-tab-counter")).toBeFocused();
    // Mobile width: the workspace stays usable (single column, no horizontal overflow).
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId("play-timing-BEGIN_COMBAT")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.setViewportSize({ width: 1280, height: 900 });
    // The existing Card Library print page is untouched by WO10.
    await page.goto(`/characters/${id}/cards/print`);
    await expect(page.getByTestId("print-card").first()).toBeVisible({ timeout: 60_000 });
  });
});
