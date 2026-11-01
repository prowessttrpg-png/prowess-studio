import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CharacterAttackDto, CharacterAttacksDto, CharacterSheetDto, CharacterWeaponsDto, DamagePreviewDto, EquippedSummaryDto } from "../../app/characters/_lib/character-client";
import { damageText, rangeText, resolutionText } from "../../app/characters/_lib/weapon-format";
import { sheetFixture } from "./m6-wo5-sheet-fixture";

/**
 * PAS-10 M6-WO6 §86–§92, §143, §182 — Weapon & Attack presentation. The Character API client is mocked: these tests
 * prove PRESENTATION — the Main-hand / Off-hand slots, compact Attack rows in the Actions panel, the loadout editor that
 * sends ONLY the loadout choice, a STATIC firearm shown without Power, the print row limit and the Attack Library
 * inspector listing the server's own steps. Every dice expression, range and AP here is "the server's"; nothing is
 * scaled, stepped or summed in Studio.
 * Invariants: M6-I057 exact Attack identity (rows keyed by exact revisions) · M6-I061 STATIC shown without Power ·
 * M6-I066 the client sends the loadout choice only · M6-I068 the Versatile grip is explicit · M6-I070 / M6-I071 Dual
 * Wield is two Moves, never a Powerful Blow · M6-I074 nothing is rolled or spent.
 */
const client = vi.hoisted(() => ({ getSheet: vi.fn(), updatePlayState: vi.fn(), updateSheetNotes: vi.fn(), uploadPortrait: vi.fn(), updatePortraitTransform: vi.fn(), removePortrait: vi.fn(), getWeapons: vi.fn(), updateWeaponLoadout: vi.fn(), getAttacks: vi.fn() }));
vi.mock("../../app/characters/_lib/character-client", async (importActual) => ({ ...(await importActual<object>()), ...client }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const { CharacterSheet } = await import("../../app/characters/_components/sheet/CharacterSheet");
const { AttackLibraryPanel } = await import("../../app/characters/_components/AttackLibraryPanel");

beforeEach(() => {
  vi.useRealTimers();
  for (const f of Object.values(client)) f.mockReset();
});

const ref = (id: string, kind: string) => ({ entityId: id, entityVersionId: `${id}-v`, canonicalKey: `test.${id}`, definitionKind: kind, systemFamily: "EQUIPMENT" });
const preview = (final: string, damageType: string, over: Partial<DamagePreviewDto> = {}): DamagePreviewDto => ({
  profileKey: damageType.toLowerCase(),
  damageType,
  status: "PREVIEWED",
  reason: null,
  scaling: "POWER",
  base: { count: 1, sides: 8, expression: "1d8" },
  gripAdjusted: null,
  power: { authored: 6, adjustment: 0, adjusted: 6, minimum: 2, scalingStat: "STR", statScore: 6 },
  multiplier: 2,
  final: { count: Number(final.split("d")[0]), sides: Number(final.split("d")[1]), expression: final },
  steps: [
    { step: "BASE", detail: `1d8 ${damageType}` },
    { step: "POWER_MULTIPLIER", detail: "STR 6 ÷ Power 6 (minimum 2) → ×2" },
    { step: "REPEATED_DICE", detail: `1d8 × 2 → ${final}` },
  ],
  ...over,
});
const attack = (id: string, moveKey: string, hand: CharacterAttackDto["hand"], weapon: string, apCost: number, damage: DamagePreviewDto[], over: Partial<CharacterAttackDto> = {}): CharacterAttackDto => ({
  attackKey: `${weapon}-v:${id}-v`,
  hand,
  weapon: ref(weapon, "WEAPON"),
  attack: ref(id, "ATTACK"),
  moveKey,
  grip: "ONE_HANDED",
  apCost,
  mpCost: 0,
  damage,
  range: { mode: "MELEE", reachFeet: 5, rangeFeet: null, lengthFeet: null, area: null, basis: null },
  resolution: { mode: "ATTACK_ROLL", onMiss: "NO_DAMAGE" },
  accuracyModifier: 0,
  weaponProperties: [],
  moveProperties: [],
  notExecuted: [],
  eligibility: "ELIGIBLE",
  ...over,
});
const equipped = (id: string, over: Partial<EquippedSummaryDto> = {}): EquippedSummaryDto => ({ weapon: ref(id, "WEAPON"), grip: "ONE_HANDED", occupies: ["MAIN_HAND"], familyKey: id.toUpperCase(), category: "BALANCED", handedness: "VERSATILE", scalingModel: "POWER", power: 6, equipmentRole: "WEAPON", properties: [], ...over });

const LONG_BLADE = [
  attack("lb-slash", "SLASH", "MAIN_HAND", "long-blade", 2, [preview("2d10", "SLASHING", { gripAdjusted: { expression: "1d10" } })], { grip: "TWO_HANDED" }),
  attack("lb-stab", "STAB", "MAIN_HAND", "long-blade", 2, [preview("2d8", "PIERCING")], { grip: "TWO_HANDED", moveProperties: [{ trait: ref("pierce", "EQUIPMENT_TRAIT"), traitKey: "PIERCE", executionStatus: "EXECUTABLE", parameters: { amount: 1 }, summary: "Ignore X Armor." }] }),
  attack("lb-bash", "BASH", "MAIN_HAND", "long-blade", 1, [preview("2d6", "BLUDGEONING")], { grip: "TWO_HANDED" }),
];
const UNARMED = [attack("ua-strike", "STRIKE", "UNARMED", "unarmed-trained", 1, [preview("2d4", "BLUDGEONING")])];
const NAMES = { "long-blade-v": "Long Blade", "lb-slash-v": "Slash", "lb-stab-v": "Stab", "lb-bash-v": "Bash", "ua-strike-v": "Strike", "rifle-v": "Rifle", "rf-single-v": "Single Shot", "shield-v": "Light Shield", "unarmed-trained-v": "Unarmed (Trained)" };

function equippedSheet(over: Partial<CharacterSheetDto> = {}): CharacterSheetDto {
  const base = sheetFixture();
  return sheetFixture({
    equipment: { ...base.equipment, available: true, mainHand: equipped("long-blade", { grip: "TWO_HANDED", occupies: ["MAIN_HAND", "OFF_HAND"] }), loadoutVersion: 2 },
    weaponAttacks: [...UNARMED, ...LONG_BLADE],
    names: { ...base.names, ...NAMES },
    ...over,
  });
}

const weaponsDto = (over: Partial<CharacterWeaponsDto> = {}): CharacterWeaponsDto => ({
  capability: { weaponLibrary: { status: "WEAPON_LIBRARY_READY", missing: [] }, attackLibrary: { status: "ATTACK_LIBRARY_READY", missing: [] } },
  loadout: { version: 2, status: "VALID", issues: [], mainHand: null, offHand: null },
  options: [
    { weapon: ref("long-blade", "WEAPON"), familyKey: "LONG_BLADE", profileKind: "STANDARD", equipmentRole: "WEAPON", category: "BALANCED", handedness: "VERSATILE", scalingModel: "POWER", power: 6, equippable: true, reasons: [] },
    { weapon: ref("rifle", "WEAPON"), familyKey: "RIFLE", profileKind: "STANDARD", equipmentRole: "WEAPON", category: "FIREARM", handedness: "TWO_HANDED", scalingModel: "STATIC", power: null, equippable: true, reasons: [] },
    { weapon: ref("shield", "WEAPON"), familyKey: "LIGHT_SHIELD", profileKind: "STANDARD", equipmentRole: "SHIELD", category: "LIGHT", handedness: "ONE_HANDED", scalingModel: "POWER", power: 4, equippable: false, reasons: ["requires Martial Trained (the Character has Martial Untrained)"] },
    { weapon: ref("unarmed-trained", "WEAPON"), familyKey: "UNARMED", profileKind: "UNARMED", equipmentRole: "WEAPON", category: null, handedness: null, scalingModel: "POWER", power: 4, equippable: false, reasons: [] },
  ],
  names: NAMES,
  ...over,
});

describe("M6-WO6 sheet Weapon slots and Attack rows (§86–§88)", () => {
  it("Equipment & Gear shows the equipped Weapon, its grip and Power; a two-handed grip leaves the Off hand empty (M6-I067)", async () => {
    client.getSheet.mockResolvedValue(equippedSheet());
    render(<CharacterSheet characterId="c1" />);
    const main = await screen.findByTestId("sheet-main-hand");
    expect(main.textContent).toContain("Long Blade");
    expect(main.textContent).toContain("Two-handed grip");
    expect(main.textContent).toContain("Power 6");
    expect(screen.getByTestId("sheet-off-hand").textContent).toBe("None");
  });

  it("M6-I057 Actions lists compact rows per hand from the server's exact Attacks: Move · AP · Damage · Range · Properties", async () => {
    client.getSheet.mockResolvedValue(equippedSheet());
    render(<CharacterSheet characterId="c1" />);
    const table = await screen.findByTestId("sheet-attacks-main_hand");
    expect(within(table).getByText(/Main-hand: Long Blade/)).toBeTruthy();
    const rows = within(table).getAllByTestId("sheet-attack-row");
    expect(rows.map((r) => r.getAttribute("data-move"))).toEqual(["SLASH", "STAB", "BASH"]);
    expect(rows.map((r) => within(r).getByTestId("sheet-attack-damage").textContent)).toEqual(["2d10 Slashing", "2d8 Piercing", "2d6 Bludgeoning"]);
    expect(rows.map((r) => within(r).getByTestId("sheet-attack-ap").textContent)).toEqual(["2", "2", "1"]);
    expect(within(rows[1]!).getByTestId("sheet-attack-properties").textContent).toBe("Pierce 1");
    expect(within(screen.getByTestId("sheet-attacks-unarmed")).getAllByTestId("sheet-attack-row")).toHaveLength(1);
  });

  it("M6-I061 a STATIC firearm shows its authored dice and never a Power", async () => {
    const rifle = equipped("rifle", { category: "FIREARM", handedness: "TWO_HANDED", scalingModel: "STATIC", power: null, grip: "TWO_HANDED", properties: [{ traitKey: "LOUD", parameters: { feet: 200 }, executionStatus: "REFERENCE_ONLY" }, { traitKey: "RELOAD", parameters: {}, executionStatus: "REFERENCE_ONLY" }] });
    const shot = attack("rf-single", "SINGLE_SHOT", "MAIN_HAND", "rifle", 2, [preview("1d10", "PIERCING", { scaling: "STATIC", power: null, multiplier: null, base: { count: 1, sides: 10, expression: "1d10" }, steps: [{ step: "BASE", detail: "1d10 Piercing" }, { step: "STATIC", detail: "Static damage — STR scaling not applied" }] })], {
      range: { mode: "RANGED_MULTIPLIER", reachFeet: null, rangeFeet: 120, lengthFeet: null, area: null, basis: { stat: "PER", statScore: 6, feetPerPoint: 20 } },
    });
    const base = sheetFixture();
    client.getSheet.mockResolvedValue(sheetFixture({ equipment: { ...base.equipment, available: true, mainHand: rifle }, weaponAttacks: [shot], names: { ...base.names, ...NAMES } }));
    render(<CharacterSheet characterId="c1" />);
    const main = await screen.findByTestId("sheet-main-hand");
    expect(main.textContent).toContain("Static damage");
    expect(main.textContent).not.toMatch(/Power/);
    expect(main.textContent).toContain("Loud 200");
    const row = screen.getByTestId("sheet-attack-row");
    expect(within(row).getByTestId("sheet-attack-damage").textContent).toBe("1d10 Piercing");
    expect(within(row).getByTestId("sheet-attack-range").textContent).toBe("120 ft (20 ft × PER)");
  });

  it("print mode caps the Weapon Attack rows and says more are in the digital sheet; no loadout controls print", async () => {
    const many = Array.from({ length: 9 }, (_, i) => attack(`m${i}`, `MOVE_${i}`, "MAIN_HAND", "long-blade", 1, [preview("1d6", "SLASHING")]));
    client.getSheet.mockResolvedValue(equippedSheet({ weaponAttacks: many }));
    render(<CharacterSheet characterId="c1" mode="print" />);
    await screen.findByTestId("sheet-weapon-attacks");
    expect(screen.getAllByTestId("sheet-attack-row").length).toBeLessThan(9);
    expect(screen.getByText("More Weapon Attacks are listed in the digital sheet.")).toBeTruthy();
    expect(screen.queryByTestId("sheet-loadout-edit")).toBeNull();
  });

  it("M6-I070 / M6-I071 Dual Wielding is described as one Move from each hand at the higher AP — never a Powerful Blow", async () => {
    client.getSheet.mockResolvedValue(equippedSheet({ dualWield: { available: true, reasons: [] } }));
    render(<CharacterSheet characterId="c1" />);
    expect((await screen.findByTestId("sheet-dual-wield")).textContent).toBe("Dual Wielding available: one Move from each hand for the higher AP of the two.");
    expect(document.body.textContent).not.toMatch(/Powerful Blow/);
  });
});

describe("M6-WO6 loadout editor (§69–§76, §143)", () => {
  it("M6-I066 / M6-I068 choosing a Versatile Weapon asks for an explicit grip and sends ONLY the loadout choice", async () => {
    const base = sheetFixture();
    client.getSheet.mockResolvedValue(sheetFixture({ equipment: { ...base.equipment, available: true, loadoutVersion: 2 }, names: { ...base.names, ...NAMES } }));
    client.getWeapons.mockResolvedValue(weaponsDto());
    client.updateWeaponLoadout.mockResolvedValue(weaponsDto());
    render(<CharacterSheet characterId="c1" />);
    fireEvent.click(await screen.findByTestId("sheet-loadout-edit"));
    const main = (await screen.findByTestId("sheet-loadout-main")) as HTMLSelectElement;
    expect([...main.options].map((o) => o.textContent)).toEqual(["None", "Long Blade", "Rifle", "Light Shield — requires Martial Trained (the Character has Martial Untrained)"]);
    expect([...main.options].find((o) => o.textContent?.startsWith("Light Shield"))?.disabled).toBe(true);
    expect(screen.queryByTestId("sheet-loadout-grip")).toBeNull();
    fireEvent.change(main, { target: { value: "long-blade-v" } });
    fireEvent.change(screen.getByTestId("sheet-loadout-grip"), { target: { value: "TWO_HANDED" } });
    const off = screen.getByTestId("sheet-loadout-off") as HTMLSelectElement;
    expect([...off.options].map((o) => o.value)).not.toContain("rifle-v"); // a Two-Handed Weapon is never an Off-hand option
    fireEvent.click(screen.getByTestId("sheet-loadout-save"));
    await waitFor(() => expect(client.updateWeaponLoadout).toHaveBeenCalledTimes(1));
    expect(client.updateWeaponLoadout).toHaveBeenCalledWith("c1", 2, { mainHand: { entityId: "long-blade", entityVersionId: "long-blade-v" }, mainHandGrip: "TWO_HANDED", offHand: null });
    await waitFor(() => expect(client.getSheet).toHaveBeenCalledTimes(2)); // the server's new sheet is reloaded
  });

  it("a stale loadout write shows a reload message and keeps the editor open", async () => {
    const { CharacterApiError } = await import("../../app/characters/_lib/character-client");
    const base = sheetFixture();
    client.getSheet.mockResolvedValue(sheetFixture({ equipment: { ...base.equipment, available: true }, names: { ...base.names, ...NAMES } }));
    client.getWeapons.mockResolvedValue(weaponsDto());
    client.updateWeaponLoadout.mockRejectedValue(new CharacterApiError("CHARACTER.STALE_WRITE", "stale", 409));
    render(<CharacterSheet characterId="c1" />);
    fireEvent.click(await screen.findByTestId("sheet-loadout-edit"));
    fireEvent.change(await screen.findByTestId("sheet-loadout-main"), { target: { value: "rifle-v" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("sheet-loadout-save"));
    });
    expect((await screen.findByTestId("sheet-loadout-error")).textContent).toBe("The loadout changed elsewhere — reopen to see the latest.");
    expect(screen.getByTestId("sheet-loadout-form")).toBeTruthy();
  });

  it("a Release without a Weapon Library shows None / None and no loadout control (WO5 boundary preserved)", async () => {
    client.getSheet.mockResolvedValue(sheetFixture());
    render(<CharacterSheet characterId="c1" />);
    expect((await screen.findByTestId("sheet-main-hand")).textContent).toBe("None");
    expect(screen.queryByTestId("sheet-loadout-edit")).toBeNull();
    expect(screen.queryByTestId("sheet-weapon-attacks")).toBeNull();
  });
});

describe("M6-WO6 Attack Library and formatting (§79–§82, M6-I074)", () => {
  const library = (over: Partial<CharacterAttacksDto["library"]> = {}): CharacterAttacksDto => ({
    loadoutVersion: 2,
    library: {
      capability: weaponsDto().capability,
      martialRank: "TRAINED",
      unarmed: { weapon: ref("unarmed-trained", "WEAPON"), attacks: UNARMED, grantedFeatures: [] },
      mainHand: { weapon: ref("long-blade", "WEAPON"), grip: "TWO_HANDED", attacks: LONG_BLADE },
      offHand: null,
      dualWield: { available: false, reasons: ["Dual Wielding needs a Weapon in each hand"], sequences: [] },
      issues: [],
      ...over,
    },
    names: NAMES,
  });

  it("the inspector lists the server's own steps — base, multiplier, repeated dice — and computes nothing", async () => {
    client.getAttacks.mockResolvedValue(library());
    render(<AttackLibraryPanel characterId="c1" />);
    const main = await screen.findByTestId("library-main-hand");
    expect(within(main).getAllByTestId("library-attack-row").map((r) => r.getAttribute("data-move"))).toEqual(["SLASH", "STAB", "BASH"]);
    const steps = within(main).getAllByTestId("attack-inspector-step").slice(0, 3);
    expect(steps.map((s) => s.getAttribute("data-step"))).toEqual(["BASE", "POWER_MULTIPLIER", "REPEATED_DICE"]);
    expect(steps[2]!.textContent).toContain("1d8 × 2 → 2d10");
    expect(screen.getByTestId("library-dual-wield").textContent).toContain("Dual Wielding needs a Weapon in each hand");
  });

  it("formatting helpers render the server's values only (fail-closed previews keep the authored base)", () => {
    expect(damageText(preview("3d8", "SLASHING"))).toBe("3d8 Slashing");
    expect(damageText(preview("1d8", "SLASHING", { status: "FAIL_CLOSED", final: null, base: { count: 2, sides: 6, expression: "2d6" }, reason: "multi-die" }))).toBe("2d6 Slashing (not previewed)");
    const auto = attack("auto", "AUTO_FIRE", "MAIN_HAND", "rifle", 3, [preview("2d10", "PIERCING")], { resolution: { mode: "SAVING_THROW", savingThrowStat: "AGI", onFailure: "FULL", onSuccess: "HALF" }, range: { mode: "CONE", reachFeet: null, rangeFeet: null, lengthFeet: 30, area: null, basis: null } });
    expect(resolutionText(auto)).toBe("AGI Save vs Character DC (Full / Half)");
    expect(rangeText(auto)).toBe("30-ft Cone");
  });
});

describe("M6-WO6 authoring editors take every option from the catalog (§93, M6-I059)", async () => {
  const { AttackResolutionEditor, AttackTargetingEditor, UseSitesEditor } = await import("../../app/compendium/admin/_components/WeaponEditors");
  const catalog = (await import("./fixtures/m6-wo1-catalog.json")).default as unknown as Parameters<typeof AttackResolutionEditor>[0]["catalog"];

  it("resolution modes, Saving Throw Stats, DCs and outcomes are the catalog's; a mode change reshapes the fields", () => {
    const onChange = vi.fn();
    const { rerender } = render(<AttackResolutionEditor value={{ mode: "" }} onChange={onChange} catalog={catalog} />);
    const mode = screen.getByLabelText("Resolution mode") as HTMLSelectElement;
    expect([...mode.options].map((o) => o.value)).toEqual(["", ...catalog.vocabularies.attackResolutionModes!]);
    fireEvent.change(mode, { target: { value: "SAVING_THROW" } });
    expect(onChange).toHaveBeenLastCalledWith({ mode: "SAVING_THROW", savingThrowStat: "", dc: catalog.vocabularies.savingThrowDcs![0], onFailure: "", onSuccess: "" });
    rerender(<AttackResolutionEditor value={onChange.mock.lastCall![0]} onChange={onChange} catalog={catalog} />);
    expect([...(screen.getByLabelText("Damage on a failed Saving Throw") as HTMLSelectElement).options].map((o) => o.value)).toEqual(["", ...catalog.vocabularies.damageOutcomes!]);
    expect([...(screen.getByLabelText("Saving Throw Stat") as HTMLSelectElement).options].map((o) => o.value)).toEqual(["", ...catalog.vocabularies.prowessStats!]);
  });

  it("targeting modes come from the catalog; a ranged mode asks for its Stat, feet per point and an optional area", () => {
    const onChange = vi.fn();
    render(<AttackTargetingEditor value={{ mode: "RANGED_MULTIPLIER", stat: "PER", feetPerPoint: 20, area: null }} onChange={onChange} catalog={catalog} />);
    expect([...(screen.getByLabelText("Targeting mode") as HTMLSelectElement).options].map((o) => o.value)).toEqual(["", ...catalog.vocabularies.attackTargetingModes!]);
    expect(screen.getByLabelText("Feet per Stat point")).toHaveProperty("value", "20");
    fireEvent.click(screen.getByLabelText("Area"));
    expect(onChange).toHaveBeenLastCalledWith({ mode: "RANGED_MULTIPLIER", stat: "PER", feetPerPoint: 20, area: { shape: catalog.vocabularies.attackAreaShapes![0], radiusFeet: null } });
  });

  it("M6-I059 Weapon and Move property use sites are the catalog's two distinct sites", () => {
    const onChange = vi.fn();
    render(<UseSitesEditor rows={[]} onChange={onChange} catalog={catalog} />);
    fireEvent.click(screen.getByLabelText("Move property"));
    expect(onChange).toHaveBeenLastCalledWith(["MOVE_PROPERTY"]);
    expect(screen.getByLabelText("Weapon property")).toBeTruthy();
  });
});
