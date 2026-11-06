import { expect, test, type Page } from "@playwright/test";
import "./m6-wo8-fixture-loader";
import type { CardDto, CardLibraryDto } from "../../app/characters/_lib/card-types";
import { sheetFixture } from "../unit/m6-wo5-sheet-fixture";

/**
 * PAS-10 M6-WO9 Phase C — real-browser Card Library, viewer, progression drawer, Character Sheet links and PRINT
 * validation (decision C5: the provisional 4 × 6 in format is accepted only if real Chromium layout / PDF output shows no
 * clipping). Browser transport fixture only: the cards are produced by the real @prowess/game projections
 * (tests/unit/m6-wo9-card-world.ts) and served through page.route; persistence and Release scoping are proven by the
 * API / DB suites. Nothing is published.
 */
const CHARACTER = "00000000-0000-4000-8000-0000000c0009";
// The card world is built from the real projections once per worker (several seconds on a cold worker).
test.describe.configure({ timeout: 180_000 });

async function world() {
  const { cardWorld } = await import("../unit/m6-wo9-card-world");
  return cardWorld();
}

/** A long, complex card for continuation: a real Maneuver card whose instructions / sources are repeated (layout stress). */
function stress(card: CardDto): CardDto {
  const blocks = Array.from({ length: 6 }, (_, r) => card.instructions.blocks.map((b) => ({ ...b, key: `${b.key}.${r}`, text: `${b.text} (repeat ${r + 1})` }))).flat();
  const sources = Array.from({ length: 4 }, () => card.provenance.sources).flat();
  const cardKey = "SIGNATURE_MANEUVER:stress:9";
  return { ...card, cardKey, name: "Stress Test Maneuver With A Deliberately Long Name To Check Wrapping", instructions: { ...card.instructions, blocks }, provenance: { ...card.provenance, sources }, snapshot: { ...card.snapshot, cardKey } };
}

async function serve(page: Page): Promise<{ lib: CardLibraryDto; stressCard: CardDto }> {
  const w = await world();
  const lib = structuredClone(w.library);
  const stressCard = stress(lib.maneuvers[0]!.current!.card!);
  // Presentation-only additions: the generated-language showcase cards and the stress card, as extra ACTIVE Abilities.
  lib.spells.push({ abilityId: "showcase-branch", abilityKind: "SPELL", status: "ACTIVE", lockVersion: 1, current: { revisionNumber: 1, card: w.chainCard, unavailable: null }, draft: null, history: [] });
  lib.maneuvers.push({ abilityId: "stress", abilityKind: "MANEUVER", status: "ACTIVE", lockVersion: 1, current: { revisionNumber: 9, card: stressCard, unavailable: null }, draft: null, history: [] });
  const sheet = sheetFixture();
  const attackCard = lib.attacks.find((c) => c.section.equipped.hand === "MAIN_HAND")!;
  const sheetData = {
    ...sheet,
    identity: { ...sheet.identity, id: CHARACTER },
    signatureSpells: [{ id: lib.spells[0]!.abilityId, name: "Ember Bolt", revisionNumber: 2, state: "VALID", finalApCost: 3, finalMpCost: 13, targeting: null, range: null, effectFamilies: [], keywords: [], duration: null, deferred: [] }],
    weaponAttacks: [{ attackKey: attackCard.section.attackKey, hand: "MAIN_HAND", weapon: attackCard.section.weapon, attack: attackCard.section.attack, moveKey: attackCard.section.moveKey, grip: "TWO_HANDED", apCost: 2, mpCost: 0, damage: [], range: attackCard.section.range, resolution: { mode: "ATTACK_ROLL", onMiss: "NO_DAMAGE" }, accuracyModifier: 0, weaponProperties: [], moveProperties: [], notExecuted: [], eligibility: "ELIGIBLE" }],
  };
  const character = {
    id: CHARACTER, name: lib.character.name, level: lib.character.level, lockVersion: lib.character.lockVersion, concept: sheet.identity.concept, status: "CORE_COMPLETE",
    coreCreationCompletedAt: "2026-11-04T00:00:00Z", createdAt: "2026-11-04T00:00:00Z", updatedAt: "2026-11-04T00:00:00Z",
    release: sheet.release, names: sheet.names,
    choices: { ancestry: sheet.identity.ancestry, ancestryStatChoices: [], statAllocations: {}, skills: [], primaryAffinity: sheet.identity.primaryAffinity },
    resolution: {
      status: "READY", issues: [], capability: { status: "READY", missing: [] },
      resolved: { level: lib.character.level, characterDie: sheet.mechanics.combat.characterDie, creationRule: null, ancestry: sheet.identity.ancestry, baseHp: null, baseMp: null, pointBudget: null, pointsSpent: 0, pointsRemaining: null, stats: [], skills: [], freeSkillCount: null, primaryAffinity: sheet.identity.primaryAffinity },
      derivedPreview: null,
    },
  };
  await page.route(`**/api/characters/${CHARACTER}`, (r) => r.fulfill({ json: { data: character } }));
  await page.route(`**/api/characters/${CHARACTER}/cards`, (r) => r.fulfill({ json: { data: lib } }));
  await page.route(`**/api/characters/${CHARACTER}/actions`, (r) => r.fulfill({ json: { data: w.directory } }));
  await page.route(`**/api/characters/${CHARACTER}/sheet`, (r) => r.fulfill({ json: { data: sheetData } }));
  await page.route(`**/api/characters/${CHARACTER}/portrait/image**`, (r) => r.fulfill({ status: 404, json: { code: "NOT_FOUND", message: "none" } }));
  return { lib, stressCard };
}

test.describe("M6-WO9 Card Library in a real browser", () => {
  test("library, mode switching and keyboard flipping keep the exact card", async ({ page }) => {
    const { lib } = await serve(page);
    const key = lib.spells[0]!.current!.card!.cardKey;
    await page.goto(`/characters/${CHARACTER}/cards?card=${encodeURIComponent(key)}`);
    await expect(page.getByTestId("card-viewer")).toHaveAttribute("data-card", key);
    for (const mode of ["tactical", "flip", "combined", "print", "illustrated"]) {
      await page.getByTestId(`mode-${mode}`).click();
      await expect(page.getByTestId("card-viewer")).toHaveAttribute("data-mode", mode);
      await expect(page.getByTestId("card-viewer")).toHaveAttribute("data-card", key);
      expect(new URL(page.url()).searchParams.get("card")).toBe(key);
    }
    await page.getByTestId("mode-flip").click();
    await page.getByTestId("card-flip").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("card-back")).toBeVisible();
    await page.keyboard.press("Space");
    await expect(page.getByTestId("card-front")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("card-viewer")).toHaveAttribute("data-mode", "flip");
    await expect(page.getByTestId("card-viewer")).toHaveAttribute("data-card", key);
  });

  test("progression drawer: grouped states, focus trap, Escape and focus restoration; mobile bottom sheet", async ({ page }) => {
    const { lib } = await serve(page);
    const dodge = lib.actions.cards.find((c) => c.section.actionKey === "DODGE_ACTION")!;
    await page.goto(`/characters/${CHARACTER}/cards?card=${encodeURIComponent(dodge.cardKey)}&mode=tactical`);
    await expect(page.getByTestId("card-ap")).toHaveText("2");
    await page.getByTestId("progression-open").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("progression-close")).toBeFocused();
    for (let i = 0; i < 40; i += 1) await page.keyboard.press("Tab");
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    await expect(page.locator('[data-improvement="EXPERT_DODGE"]')).toHaveAttribute("data-status", "UNRESOLVED");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("progression-open")).toBeFocused();
    await page.setViewportSize({ width: 390, height: 800 });
    await page.getByTestId("progression-open").click();
    const box = await page.locator(".fcard-drawer__panel").boundingBox();
    expect(box!.width).toBeGreaterThan(380);
    expect(box!.y).toBeGreaterThan(50);
  });

  test("Character Sheet links open the exact cards", async ({ page }) => {
    const { lib } = await serve(page);
    await page.goto(`/characters/${CHARACTER}`);
    await page.getByTestId("sheet-spell-card").click();
    await expect(page.getByTestId("card-viewer")).toHaveAttribute("data-card", lib.spells[0]!.current!.card!.cardKey);
    await page.goto(`/characters/${CHARACTER}`);
    await page.getByTestId("sheet-attack-card").click();
    await expect(page.getByTestId("card-viewer")).toHaveAttribute("data-card", lib.attacks.find((c) => c.section.equipped.hand === "MAIN_HAND")!.cardKey);
    await page.goto(`/characters/${CHARACTER}`);
    await page.getByTestId("sheet-action-directory-link").click();
    await expect(page.getByTestId("action-directory")).toBeVisible();
  });
});

test.describe("M6-WO9 print validation (decision C5, real Chromium layout and PDF)", () => {
  test("4 × 6 card pages: no clipping, numbered continuations, duplex pairs, readable type, matching PDF pages", async ({ page }) => {
    const { lib, stressCard } = await serve(page);
    const keys = [stressCard.cardKey, lib.spells.find((s) => s.abilityId === "showcase-branch")!.current!.card!.cardKey, lib.actions.cards.find((c) => c.section.actionKey === "DODGE_ACTION")!.cardKey, lib.attacks[lib.attacks.length - 1]!.cardKey];
    await page.goto(`/characters/${CHARACTER}/cards/print?${keys.map((k) => `card=${encodeURIComponent(k)}`).join("&")}`);
    await expect(page.getByTestId("print-card")).toHaveCount(keys.length);
    await page.emulateMedia({ media: "print" });
    const report = await page.evaluate(() => {
      const pages = [...document.querySelectorAll<HTMLElement>("[data-testid=print-page]")];
      return pages.map((p) => {
        const body = p.querySelector<HTMLElement>(".fprint-page__body")!;
        const r = p.getBoundingClientRect();
        const fonts = [...p.querySelectorAll<HTMLElement>(".fprint-page__body *")].map((el) => parseFloat(getComputedStyle(el).fontSize));
        return { card: p.dataset.card, side: p.dataset.side, w: Math.round(r.width), h: Math.round(r.height), tall: p.classList.contains("fprint-page--tall"), overflow: body.scrollHeight - body.clientHeight, minFont: Math.min(...fonts, 99), text: p.textContent ?? "" };
      });
    });
    expect(report.length).toBeGreaterThan(keys.length * 2);
    // Every list item is placeable on its own, so no page needs to flow past its 4 × 6 box.
    expect(report.filter((p) => p.tall).map((p) => p.card)).toEqual([]);
    for (const p of report) {
      expect([p.w, p.tall ? 576 : p.h]).toEqual([384, 576]);
      expect(p.overflow, `${p.card} ${p.side} clips`).toBeLessThanOrEqual(1);
      expect(p.minFont).toBeGreaterThanOrEqual(7.9);
    }
    // Duplex: each card's pages alternate front / back and are even in number; the stress card continues.
    for (const k of keys) {
      const own = report.filter((p) => p.card === k);
      expect(own.length % 2).toBe(0);
      own.forEach((p, i) => expect(p.side === "blank" || p.side === (i % 2 === 0 ? "front" : "back")).toBe(true));
    }
    const stressPages = report.filter((p) => p.card === stressCard.cardKey);
    expect(stressPages.length).toBeGreaterThan(2);
    expect(stressPages.some((p) => p.text.includes("continued"))).toBe(true);
    const all = stressPages.map((p) => p.text).join(" ");
    for (const b of stressCard.instructions.blocks) expect(all).toContain(b.text);
    for (const p of report) expect(p.text).toContain(`/ ${report.filter((q) => q.card === p.card).length}`);
    // No interactive controls print.
    expect(await page.locator(".fprint-page button, .fprint-page input, .fprint-page select, .fprint-page details").count()).toBe(0);
    // The real PDF has one 4 × 6 in page per card page.
    const pdf = (await page.pdf({ preferCSSPageSize: true, printBackground: true })).toString("latin1");
    const pdfPages = (pdf.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pdfPages).toBe(report.length);
    // Every page is 4 × 6 in (288 × 432 pt).
    expect((pdf.match(/\/MediaBox\s*\[\s*0\s+0\s+288\s+432\s*\]/g) ?? []).length).toBe(report.length);
  });

  test("combined layout prints front and back side by side on landscape Letter", async ({ page }) => {
    const { lib } = await serve(page);
    const key = lib.maneuvers[0]!.current!.card!.cardKey;
    await page.goto(`/characters/${CHARACTER}/cards/print?card=${encodeURIComponent(key)}&layout=combined`);
    await expect(page.getByTestId("print-sheet").first()).toBeVisible();
    await page.emulateMedia({ media: "print" });
    const sheets = await page.getByTestId("print-sheet").evaluateAll((els) => els.map((e) => ({ n: e.querySelectorAll("[data-testid=print-page]").length, w: Math.round(e.getBoundingClientRect().width) })));
    for (const s of sheets) expect(s).toEqual({ n: 2, w: 1056 });
    const pdf = (await page.pdf({ preferCSSPageSize: true, printBackground: true })).toString("latin1");
    expect((pdf.match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(sheets.length);
    expect(pdf).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+792\s+612\s*\]/);
  });

  test("the Character Sheet print is unchanged: Letter pages without card links", async ({ page }) => {
    await serve(page);
    await page.goto(`/characters/${CHARACTER}/print`);
    await expect(page.getByTestId("sheet-page-1")).toBeVisible();
    await expect(page.getByTestId("sheet-spell-card")).toHaveCount(0);
    await expect(page.getByTestId("sheet-card-links")).toHaveCount(0);
    const pdf = (await page.pdf({ preferCSSPageSize: true, printBackground: true })).toString("latin1");
    expect(pdf).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+612\s+792\s*\]/);
  });
});
