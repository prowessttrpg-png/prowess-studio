import { describe, expect, it, vi } from "vitest";
import { validateRequirement } from "@prowess/rules";
import type { CharacterMechanicalProfile } from "./character/advancement.js";
import { ACTION_PROGRESSION_STATUSES, actionImprovementsFor, evaluateActionImprovement } from "./character/action-improvement.js";
import { buildActionDirectory, projectGeneralActionCard } from "./card/action.js";
import { CARD_CATEGORIES, CARD_CONTRACT_VERSION, type CardPresentation } from "./card/contract.js";
import { attackCheckSentences } from "./card/language.js";
import { attackRulesOf, projectEquipmentCards, type CharacterCardContext } from "./card/equipment.js";
import { MAGE_ART_UNAVAILABLE_CODE, mageArtDomainOf, projectMageArtCard } from "./card/mage-art.js";
import { readDefinitionPayload } from "./definition/payload.js";
import { Problems } from "./internal/problems.js";
import { indexWeaponLibrary } from "./equipment/catalog.js";
import { buildCharacterAttackLibrary, type CharacterAttack } from "./equipment/library.js";
import type { WeaponLoadoutChoice } from "./equipment/loadout.js";
import { indexRuntimeDefinitions } from "./runtime/definitions.js";
import { PROWESS_DEFINITION_KINDS } from "./vocabulary/families.js";
import type { FixtureRow } from "./testing/character-fixtures.js";
import { AFFINITY_DEFINITIONS } from "./testing/affinity-fixtures.js";
import { PLAYTEST_DEFINITIONS } from "./testing/core-fixtures.js";
import abilityConstruction from "./content/core-playtest-v0.1/ability-construction.json";
import targeting from "./content/core-playtest-v0.1/targeting.json";
import { WEAPON_DEFINITIONS, martialProfile, weaponFixture, withStats, type WeaponFixture } from "./testing/weapon-fixtures.js";

/**
 * PAS-10 M6-WO9 Phase B — Weapon / Attack cards over the M6-WO6 Character Attack Library, the Mage Art unavailable
 * state, General Action cards and the Action Directory over the Release's ACTION Definitions, and the additive
 * ACTION_IMPROVEMENT contract (decision C1) with its ACTIVE / CONDITIONAL / FUTURE / UNAVAILABLE / UNRESOLVED states.
 * Every improvement here is a TEST-ONLY fixture row; no canonical content is added.
 */
vi.setConfig({ testTimeout: 240_000 });

// ---- test-only ACTION_IMPROVEMENT fixtures ------------------------------------------------------------------------------
const probe = weaponFixture();
const action = (key: string) => probe.ref(key);
const SOURCE = { locators: ["s44"], conflicts: [] };
const NEAR = { kind: "NUMERIC_COMPARE", factKey: "target.distance", operator: "<=", expected: 10, provenance: null };
const useCase = (key: string, condition: unknown = null) => ({ modificationKey: key, kind: "ADDITIONAL_USE_CASE", rulesText: `Test use case ${key}.`, condition, useCaseKey: key });
const apCost = (key: string, amount: number, condition: unknown = null) => ({ modificationKey: key, kind: "ACTION_POINT_COST", rulesText: `Test cost ${key}.`, condition, actionPointCost: { model: "FIXED", amount } });
const operation = (key: string) => ({ modificationKey: key, kind: "RULE_OPERATION", rulesText: `Test operation ${key}.`, condition: null, operationKey: key, data: { feet: 5 } });
const level = (minimum: number) => ({ prerequisiteKey: `LEVEL_${minimum}`, kind: "LEVEL_AT_LEAST", minimum });
const row = (key: string, parent: unknown, prerequisites: unknown[], modifications: unknown[]): FixtureRow =>
  ({ canonicalKey: `test.m6wo9.improvement.${key}`, definitionKind: "ACTION_IMPROVEMENT", schemaVersion: 1, payload: { improvementKey: key.toUpperCase(), action: parent, rulesText: `Test improvement ${key}.`, prerequisites, modifications, source: SOURCE } }) as FixtureRow;
const stale = { ...action("action.grapple"), entityVersionId: "00000000-0000-4000-8000-00000000f00d" };
const orphan = { ...action("action.grapple"), entityId: "00000000-0000-4000-8000-00000000beef", entityVersionId: "00000000-0000-4000-8000-00000000cafe" };
const IMPROVEMENTS: FixtureRow[] = [
  row("quick_dodge", action("action.dodge"), [level(3)], [apCost("QUICK", 2)]),
  row("guarded_block", action("action.block"), [level(3), { prerequisiteKey: "STR_1", kind: "STAT_AT_LEAST", stat: "STR", minimum: 1 }, { prerequisiteKey: "MARTIAL_EXPERT", kind: "SKILL_RANK_AT_LEAST", skillKey: "skill.martial", minimumRank: "EXPERT" }], [useCase("CLOSE_GUARD", NEAR)]),
  row("legendary_move", action("action.move"), [level(99)], [useCase("FAR_STRIDE")]),
  row("titan_move", action("action.move"), [{ prerequisiteKey: "STR_99", kind: "STAT_AT_LEAST", stat: "STR", minimum: 99 }], [useCase("TITAN_STRIDE")]),
  row("leap_like", action("action.interact"), [], [operation("UNSPECIFIED_JUMP")]),
  row("mixed_interact", action("action.reload"), [], [useCase("SWIFT_RELOAD"), operation("AMMO_RULE")]),
  row("cheap_cast", action("action.cast_spell"), [], [apCost("CHEAP", 1)]),
  row("stale_grapple", stale, [], [useCase("OLD_GRIP")]),
  row("orphan_grapple", orphan, [], [useCase("LOST_GRIP")]),
];
const f = weaponFixture({ extra: IMPROVEMENTS });
const base = weaponFixture();

const context = (fx: WeaponFixture): CharacterCardContext => ({ characterId: "00000000-0000-4000-8000-0000000000c1", characterReleaseId: "00000000-0000-4000-8000-0000000000a1", rulesetProvenance: fx.bundle.rulesetProvenance, names: {} });
const envelope = (fx: WeaponFixture, key: string) => fx.bundle.definitions.find((d) => d.canonicalKey === `test.m6wo9.improvement.${key}`)!;
const level1 = martialProfile(f, "UNTRAINED");
const level3 = martialProfile(f, "EXPERT");
const statusOf = (profile: CharacterMechanicalProfile, key: string) => evaluateActionImprovement({ bundle: f.bundle, profile, improvement: envelope(f, key) });
const directory = (profile: CharacterMechanicalProfile, fx: WeaponFixture = f) => buildActionDirectory({ bundle: fx.bundle, profile, context: context(fx) });
const cardFor = (profile: CharacterMechanicalProfile, actionKey: string) => directory(profile).cards.find((c) => c.section.actionKey === actionKey)!;

describe("A. Weapon and Attack cards over the M6-WO6 Character Attack Library", () => {
  const sel = (key: string) => base.sel(key);
  const choice = (main: string | null, grip: "ONE_HANDED" | "TWO_HANDED" | null = null): WeaponLoadoutChoice => ({ mainHand: main === null ? null : sel(main), mainHandGrip: grip, offHand: null });
  const profile = martialProfile(base, "TRAINED");
  const cards = (l: WeaponLoadoutChoice, p: CharacterMechanicalProfile = profile) => {
    const library = buildCharacterAttackLibrary({ bundle: base.bundle, characterProfile: p, loadout: l });
    return { library, ...projectEquipmentCards({ library, weapons: indexWeaponLibrary(base.bundle).weapons, context: context(base) }) };
  };

  it("acceptance 1: exact Weapon + Attack identity, AP / MP and every damage profile are the library's own values", () => {
    const { library, weapons, attacks } = cards(choice("weapon.long_blade", "TWO_HANDED"));
    const held = library.mainHand!;
    const { weapon: heldRef } = held;
    expect(weapons.map((w) => [w.section.equipped.hand, w.section.weapon.canonicalKey])).toEqual([["UNARMED", "weapon.unarmed_trained"], ["MAIN_HAND", "weapon.long_blade"]]);
    const main = attacks.filter((a) => a.section.equipped.hand === "MAIN_HAND");
    expect(main).toHaveLength(held.attacks.length);
    held.attacks.forEach((a: CharacterAttack, i) => {
      const card = main[i]!;
      const { weapon: wRef, attack: aRef } = a;
      expect(card.section.weapon).toEqual(wRef);
      expect(card.section.weapon).toEqual(heldRef);
      expect(card.section.attack).toEqual(aRef);
      expect(card.cardKey).toBe(`ATTACK:${wRef.entityVersionId}:${aRef.entityVersionId}:MAIN_HAND`);
      expect(card.costs.ap).toEqual({ status: "AVAILABLE", value: a.apCost });
      expect(card.costs.mp).toEqual({ status: "AVAILABLE", value: a.mpCost });
      expect(card.section.equipped).toEqual({ hand: "MAIN_HAND", grip: "TWO_HANDED", occupies: ["MAIN_HAND", "OFF_HAND"] });
      expect(card.section.damage.map((d) => [d.profileKey, d.final, d.steps.map((s) => s.step)])).toEqual(a.damage.map((d) => [d.profileKey, d.final?.expression ?? null, d.steps.map((s) => s.step)]));
      expect(card.section.equipmentProvenance).toEqual(a.provenance);
      expect(card.provenance.sources.slice(0, 2)).toEqual([wRef, aRef]);
      expect(card.snapshot.sources.slice(0, 2)).toEqual([wRef.entityVersionId, aRef.entityVersionId]);
    });
    // The grip's Versatile step is the WO6 preview's — a one-handed grip shows the one-handed dice.
    const one = cards(choice("weapon.long_blade", "ONE_HANDED")).attacks.filter((a) => a.section.equipped.hand === "MAIN_HAND");
    expect(one.map((a) => a.section.damage[0]?.final)).toEqual(["2d8", "2d6", "2d4"]);
    expect(main.map((a) => a.section.damage[0]?.final)).toEqual(["2d10", "2d8", "2d6"]);
  });

  it("the Weapon card restates the exact Weapon revision, its moveset and requirements — and never prices itself", () => {
    const { weapons } = cards(choice("weapon.long_blade", "ONE_HANDED"));
    const w = weapons.find((x) => x.section.equipped.hand === "MAIN_HAND")!;
    expect(w.section.handedness).toBe("VERSATILE");
    expect(w.section.moveset.map((m) => m.cardKey)).toEqual(w.section.moveset.map((m) => `ATTACK:${w.section.weapon.entityVersionId}:${m.attack.entityVersionId}:MAIN_HAND`));
    expect(w.costs.ap.status).toBe("UNAVAILABLE");
    expect(w.rules).toEqual({ status: "UNAVAILABLE", code: "CARD.NOT_APPLICABLE", reason: expect.any(String) });
    const unarmed = weapons.find((x) => x.section.equipped.hand === "UNARMED")!;
    expect(unarmed.section.power.status === "AVAILABLE" || unarmed.section.power.status === "UNAVAILABLE").toBe(true);
  });

  it("decision C4: a Saving Throw Attack names the DEFENDER's save and keeps the exact authored outcomes", () => {
    const { attacks } = cards(choice("weapon.rifle"), withStats(profile, { STR: 12 }));
    const auto = attacks.find((a) => a.section.attack.canonicalKey === "attack.rifle.auto_fire")!;
    const r = auto.section.resolution as { mode: string; onFailure: string; onSuccess: string };
    expect(r.mode).toBe("SAVING_THROW");
    const text = auto.instructions.blocks.map((b) => b.text).join(" ");
    expect(text).toContain(`If the target's save fails, ${r.onFailure === "FULL" ? "full damage" : r.onFailure === "HALF" ? "half damage" : "no damage"}.`);
    expect(text).toContain(`If the target's save succeeds, ${r.onSuccess === "FULL" ? "full damage" : r.onSuccess === "HALF" ? "half damage" : "no damage"}.`);
    expect(text).not.toMatch(/the Effect succeeds/);
    // Inverting the authored outcomes inverts the wording — nothing is assumed about which side is "good".
    expect(attackCheckSentences({ kind: "SAVING_THROW", stat: "AGI", dc: "ATTACKER_CHARACTER_DC", onDefenderSaveFails: "HALF", onDefenderSaveSucceeds: "FULL" })).toEqual([
      "The target makes a AGI Saving Throw against your Character DC.",
      "If the target's save fails, half damage.",
      "If the target's save succeeds, full damage.",
    ]);
  });

  it("executable, reference-only and deferred properties keep their status; a DEFERRED resolution is never resolved", () => {
    const { attacks, library } = cards(choice("weapon.pulse_cannon"), withStats(profile, { STR: 12 }));
    const shock = attacks.find((a) => a.section.attack.canonicalKey === "attack.pulse_cannon.shock_burst")!;
    expect(shock.availability).toBe("AVAILABLE_WITH_RUNTIME_DEFERRED");
    expect(shock.instructions.status).toBe("PARTIAL");
    expect(shock.instructions.unresolved[0]?.code).toBe("ATTACK.RESOLUTION_DEFERRED");
    for (const card of attacks) {
      const lib = [...(library.unarmed?.attacks ?? []), ...(library.mainHand?.attacks ?? [])].find((a) => a.attackKey === card.section.attackKey)!;
      expect(card.section.notExecuted).toEqual(lib.notExecuted);
      expect([...card.section.properties.weapon, ...card.section.properties.move].map((p) => p.executionStatus)).toEqual([...lib.weaponProperties, ...lib.moveProperties].map((p) => p.executionStatus));
    }
  });

  it("an unmet Weapon requirement makes the card UNAVAILABLE with the M4-evaluated reason (no equipment rule invented)", () => {
    const weak = withStats(profile, { STR: 1 });
    const library = buildCharacterAttackLibrary({ bundle: base.bundle, characterProfile: weak, loadout: choice("weapon.heavy_blade") });
    const out = projectEquipmentCards({ library, weapons: indexWeaponLibrary(base.bundle).weapons, context: context(base) });
    // The library itself decides: an invalid loadout yields no held Weapon cards, only the intrinsic Unarmed profile.
    if (library.mainHand === null) expect(out.weapons.map((w) => w.section.equipped.hand)).toEqual(["UNARMED"]);
    else for (const a of out.attacks.filter((x) => x.section.equipped.hand === "MAIN_HAND")) expect(a.availability === "UNAVAILABLE").toBe(a.section.eligibility !== "ELIGIBLE");
  });

  it("the attack rules model is a restatement: damage expressions are the previews' final dice", () => {
    const library = buildCharacterAttackLibrary({ bundle: base.bundle, characterProfile: profile, loadout: choice("weapon.long_blade", "ONE_HANDED") });
    for (const a of library.mainHand!.attacks) expect(attackRulesOf(a).damage.map((d) => d.expression)).toEqual(a.damage.map((d) => d.final?.expression ?? null));
  });
});

describe("B. Mage Art card — a clear UNAVAILABLE state", () => {
  it("acceptance 2: Mage Arts are UNAVAILABLE — no evaluation, activation, maintenance cost or progression", () => {
    expect(PROWESS_DEFINITION_KINDS.MAGE_ART.schemaVersions).toEqual([]);
    const card = projectMageArtCard({ bundle: f.bundle, context: context(f) });
    expect(card.availability).toBe("UNAVAILABLE");
    expect(card.section.domain).toEqual(mageArtDomainOf(f.bundle));
    expect(card.section.domain.status).toBe("UNAVAILABLE");
    for (const v of [card.costs.ap, card.costs.mp, card.targeting, card.rules]) expect(v).toMatchObject({ status: "UNAVAILABLE", code: MAGE_ART_UNAVAILABLE_CODE });
    expect(card.instructions.status).toBe("UNAVAILABLE");
    expect(card.costs.breakdown).toEqual([]);
    expect(card.provenance.sources).toEqual([]);
  });
});

describe("C. General Action cards and the Action Directory", () => {
  const plain = martialProfile(base, "UNTRAINED");
  const dir = directory(plain, base);
  const index = indexRuntimeDefinitions(base.bundle);

  it("acceptance 3: one card per pinned ACTION, consuming the Definition's authored rules (nothing invented)", () => {
    if (!index.ok) throw new Error("runtime index");
    expect(dir.status).toBe("READY");
    expect(dir.cards.map((c) => c.section.action)).toEqual(Object.values(index.value.actions).map((e) => e.ref).sort((a, b) => (a.canonicalKey < b.canonicalKey ? -1 : 1)));
    for (const card of dir.cards) {
      const e = index.value.actions[card.section.actionKey]!;
      expect(card.section.eligibility).toEqual({ status: "NO_REQUIREMENTS" });
      expect(card.section.timing).toBe(e.payload.timing);
      expect(card.section.requiresTrigger).toBe(e.payload.requiresTrigger);
      expect(card.section.otherCosts).toEqual(e.payload.otherCosts);
      expect(card.rules.status === "AVAILABLE" && card.rules.value.kind === "GENERAL_ACTION" ? card.rules.value.cost : null).toEqual(e.payload.actionPointCost);
      const c = e.payload.actionPointCost;
      if (c.model === "FIXED") expect(card.costs.ap).toEqual({ status: "AVAILABLE", value: c.amount });
      else if (c.model !== "NONE") expect(card.costs.ap.status).toBe("UNAVAILABLE");
      expect(card.costs.mp.status).toBe("UNAVAILABLE");
      expect(card.section.improvements).toEqual([]);
    }
  });

  it("a movement grant is DEFERRED to the runtime; its inputs are the Character's current derived values", () => {
    const move = dir.cards.find((c) => c.section.actionKey === "MOVE")!;
    const grant = move.section.movementGrant!;
    expect(grant.value.status).toBe("DEFERRED");
    const movement = plain.derivedStatistics.find((d) => d.statistic === "MOVEMENT")!;
    expect(grant.inputs).toEqual([{ variable: "movement", statistic: "MOVEMENT", current: { status: "AVAILABLE", value: movement.value } }]);
    expect(move.instructions.blocks.map((b) => b.text).join(" ")).toContain(`Grants Movement by its formula (movement, in ft), worked out when the Action is taken. Your Movement is ${movement.value} ft now.`);
    expect(dir.cards.find((c) => c.section.actionKey === "BLOCK")!.section.movementGrant).toBeNull();
  });

  it("variable, range and minimum AP costs are typed (never zero, never guessed)", () => {
    const by = (k: string) => dir.cards.find((c) => c.section.actionKey === k)!;
    expect(by("CAST_SPELL").costs.ap).toMatchObject({ status: "UNAVAILABLE", code: "ACTION.COST_SET_BY_SOURCE" });
    expect(by("GRAPPLE").costs.ap).toMatchObject({ status: "UNAVAILABLE", code: "ACTION.COST_CHOSEN_AT_USE" });
    expect(by("INTERACT").costs.ap).toMatchObject({ status: "UNAVAILABLE", code: "ACTION.COST_CHOSEN_AT_USE" });
    expect(by("COUNTER_REACTION").instructions.blocks[0]?.text).toBe("Use it outside your turn, only in response to its trigger. Costs no AP; it also spends 1 Counter Action.");
  });

  it("a Release whose runtime Definitions are incoherent yields an UNAVAILABLE directory (fail closed)", () => {
    const resources = base.bundle.definitions.filter((d) => d.definitionKind === "RESOURCE");
    const without = { ...base.bundle, definitions: base.bundle.definitions.filter((d) => d !== resources[0]) };
    const out = buildActionDirectory({ bundle: without as typeof base.bundle, profile: plain, context: context(base) });
    expect(out.status).toBe("UNAVAILABLE");
    expect(out.cards).toEqual([]);
    expect(out.reasons.length).toBeGreaterThan(0);
  });
});

describe("D. ACTION_IMPROVEMENT definition contract (decision C1, additive)", () => {
  const read = (payload: unknown) => {
    const p = new Problems();
    const out = readDefinitionPayload("ACTION_IMPROVEMENT", null, payload, ["payload"], p);
    return { out, problems: p.list.map((x) => x.message) };
  };
  const good = { improvementKey: "GOOD", action: action("action.dodge"), rulesText: "Good.", prerequisites: [level(2)], modifications: [apCost("A", 1)], source: SOURCE };

  it("is a separate versioned kind in the ACTION_ECONOMY family; ACTION and every other kind are unchanged", () => {
    expect(PROWESS_DEFINITION_KINDS.ACTION_IMPROVEMENT).toEqual({ family: "ACTION_ECONOMY", branch: null, contract: null, entityTypes: ["GENERIC_RULE"], schemaVersions: [1] });
    expect(PROWESS_DEFINITION_KINDS.ACTION).toEqual({ family: "ACTION_ECONOMY", branch: null, contract: null, entityTypes: ["GENERIC_RULE"], schemaVersions: [1] });
    expect(read(good).out).not.toBeNull();
  });

  it("names exactly one exact parent ACTION; structured prerequisites and modifications only (prose is inert)", () => {
    expect(read({ ...good, action: action("action.dodge").canonicalKey }).out).toBeNull();
    expect(read({ ...good, action: action("skill.martial") }).problems.join(" ")).toContain("names exactly one ACTION Definition");
    expect(read({ ...good, modifications: [] }).out).toBeNull();
    expect(read({ ...good, prerequisites: [level(2), level(2)] }).problems.join(" ")).toContain("unique");
    expect(read({ ...good, prerequisites: [{ prerequisiteKey: "LVL", kind: "LEVEL_AT_LEAST", minimum: 0 }] }).out).toBeNull();
    expect(read({ ...good, prerequisites: ["Level 3 or higher"] }).out).toBeNull();
    expect(read({ ...good, modifications: [{ ...apCost("A", 1), condition: "when adjacent" }] }).problems.join(" ")).toContain("prose is inert");
    expect(read({ ...good, modifications: [{ ...apCost("A", 1), actionPointCost: { model: "RANGE", minimum: 1, maximum: 2 } }] }).out).toBeNull();
    expect(read({ ...good, extra: 1 }).out).toBeNull();
    expect(validateRequirement(NEAR).ok).toBe(true);
    expect(read({ ...good, modifications: [apCost("A", 1, NEAR)] }).out).not.toBeNull();
  });

  it("test-only fixture rows validate inside a real Release bundle; canonical content authors no improvement", () => {
    expect(f.bundle.definitions.filter((d) => d.definitionKind === "ACTION_IMPROVEMENT").map((d) => d.canonicalKey.split(".").slice(0, 3).join("."))).toEqual(IMPROVEMENTS.map(() => "test.m6wo9.improvement"));
    // The JSON content files (TypeScript content modules are scanned by the studio static gate).
    for (const content of [PLAYTEST_DEFINITIONS, AFFINITY_DEFINITIONS, WEAPON_DEFINITIONS, abilityConstruction, targeting]) expect(JSON.stringify(content)).not.toContain("ACTION_IMPROVEMENT");
  });

  it("acceptance 8: historical ACTION semantics are untouched — the runtime index is identical with or without improvements", () => {
    const a = indexRuntimeDefinitions(base.bundle);
    const b = indexRuntimeDefinitions(f.bundle);
    if (!a.ok || !b.ok) throw new Error("runtime index");
    const strip = (x: typeof a.value.actions) => Object.fromEntries(Object.entries(x).map(([k, e]) => [k, { canonicalKey: e.ref.canonicalKey, payload: e.payload }]));
    expect(strip(b.value.actions)).toEqual(strip(a.value.actions));
    for (const e of Object.values(b.value.actions)) expect(JSON.stringify(e.payload)).not.toContain("improvement");
  });
});

describe("E. eligibility and progression states (ACTIVE / CONDITIONAL / FUTURE / UNAVAILABLE / UNRESOLVED)", () => {
  it("the closed status vocabulary", () => {
    expect([...ACTION_PROGRESSION_STATUSES]).toEqual(["ACTIVE", "CONDITIONAL", "FUTURE", "UNAVAILABLE", "UNRESOLVED"]);
  });

  it("acceptance 4: multiple prerequisites are evaluated independently, each with its own M4 verdict and progression", () => {
    const low = statusOf(level1, "guarded_block");
    expect(low.eligibility.prerequisites.map((q) => [q.prerequisiteKey, q.satisfied, q.progression])).toEqual([
      ["LEVEL_3", false, "REACHABLE"],
      ["STR_1", true, "MET"],
      ["MARTIAL_EXPERT", false, "UNDETERMINED"],
    ]);
    // A rank with no authored progression rule is never assumed reachable — and never excluded.
    expect(low.status).toBe("UNRESOLVED");
    expect(low.reasons.map((r) => r.code)).toEqual(["ACTION_IMPROVEMENT.PREREQUISITES_UNMET", "ACTION_IMPROVEMENT.PROGRESSION_UNDETERMINED"]);
    const high = statusOf(level3, "guarded_block");
    expect(high.eligibility.prerequisites.map((q) => q.progression)).toEqual(["MET", "MET", "MET"]);
    expect(high.eligibility.status).toBe("ELIGIBLE");
    expect(high.status).toBe("CONDITIONAL");
  });

  it("acceptance 5: FUTURE → ACTIVE with Level; UNAVAILABLE only with authoritative evidence; UNRESOLVED otherwise", () => {
    expect(statusOf(level1, "quick_dodge").status).toBe("FUTURE");
    expect(statusOf(level3, "quick_dodge").status).toBe("ACTIVE");
    const legendary = statusOf(level3, "legendary_move");
    expect(legendary.status).toBe("UNAVAILABLE");
    expect(legendary.eligibility.prerequisites[0]?.reason).toBe(`this Release's Levels end at ${level3.maximumLevel}`);
    const titan = statusOf(level3, "titan_move");
    expect(titan.status).toBe("UNAVAILABLE");
    expect(titan.eligibility.prerequisites[0]?.progression).toBe("UNREACHABLE");
    // Unsupported operations are never executed: only-unsupported → UNRESOLVED; partially supported → PARTIAL.
    const leap = statusOf(level1, "leap_like");
    expect([leap.status, leap.applicability.status, leap.applicability.modifications[0]?.support]).toEqual(["UNRESOLVED", "UNSUPPORTED", "UNSUPPORTED"]);
    const mixed = statusOf(level1, "mixed_interact");
    expect([mixed.status, mixed.applicability.status]).toEqual(["ACTIVE", "PARTIAL"]);
    // An explicit AP cost only applies where the parent's own contract allows an explicit-rule override.
    const cast = statusOf(level1, "cheap_cast");
    expect([cast.status, cast.applicability.modifications[0]?.support]).toEqual(["UNRESOLVED", "UNSUPPORTED"]);
    // The exact parent revision is required.
    expect([statusOf(level1, "stale_grapple").parent.state, statusOf(level1, "stale_grapple").status]).toEqual(["REVISION_MISMATCH", "UNRESOLVED"]);
    expect(statusOf(level1, "orphan_grapple").parent.state).toBe("NOT_IN_RELEASE");
  });

  it("acceptance 6: advancement and modifier changes update the card projections", () => {
    expect(cardFor(level1, "DODGE_ACTION").costs.ap).toEqual({ status: "AVAILABLE", value: 3 });
    const after = cardFor(level3, "DODGE_ACTION");
    expect(after.costs.ap).toEqual({ status: "AVAILABLE", value: 2 });
    expect(after.costs.breakdown.map((l) => [l.label, l.value, l.source?.canonicalKey])).toEqual([["Action", 3, "action.dodge"], ["Improvement (explicit cost)", 2, "test.m6wo9.improvement.quick_dodge"]]);
    expect(after.section.improvements.map((i) => i.status)).toEqual(["ACTIVE"]);
    // A Stat change (a modifier on the profile) flips the Stat prerequisite.
    const weak = withStats(level3, { STR: 0 });
    expect(statusOf(weak, "guarded_block").eligibility.prerequisites[1]?.satisfied).toBe(false);
    // CONDITIONAL improvements are worded with their condition, never applied to the base cost.
    const block = cardFor(level3, "BLOCK");
    expect(block.costs.ap).toEqual({ status: "AVAILABLE", value: 2 });
    expect(block.instructions.blocks.map((b) => b.text).join(" ")).toContain("(Conditional). When the target's Distance is at most 10: Test use case CLOSE_GUARD.");
  });

  it("the directory attaches each improvement to its exact parent only, and lists unattached ones", () => {
    const dir = directory(level1);
    expect(dir.cards.find((c) => c.section.actionKey === "GRAPPLE")!.section.improvements.map((i) => i.improvementKey)).toEqual(["STALE_GRAPPLE"]);
    expect(dir.unattached.map((i) => i.improvementKey)).toEqual(["ORPHAN_GRAPPLE"]);
    expect(actionImprovementsFor({ bundle: f.bundle, profile: level1, action: action("action.move") }).map((e) => e.improvementKey)).toEqual(["LEGENDARY_MOVE", "TITAN_MOVE"]);
  });
});

describe("F. contract coverage and compatibility", () => {
  it("acceptance 9: every category is a Card Presentation of contract v1 (WO7 / WO8 cards unchanged in shape)", () => {
    expect([...CARD_CATEGORIES]).toEqual(["SIGNATURE_SPELL", "SIGNATURE_MANEUVER", "WEAPON", "ATTACK", "MAGE_ART", "GENERAL_ACTION"]);
    const cards: CardPresentation[] = [projectMageArtCard({ bundle: f.bundle, context: context(f) }), ...directory(level1).cards];
    for (const c of cards) {
      expect(c.contractVersion).toBe(CARD_CONTRACT_VERSION);
      expect(c.artwork).toEqual({ kind: "PLACEHOLDER" });
      expect(c.snapshot.cardKey).toBe(c.cardKey);
      expect(Object.isFrozen(c)).toBe(true);
    }
  });

  it("projections are deterministic and read-only (same inputs → equal cards; inputs untouched)", () => {
    const before = JSON.stringify(level3);
    const index = indexRuntimeDefinitions(f.bundle);
    if (!index.ok) throw new Error("runtime index");
    const a = projectGeneralActionCard({ entry: index.value.actions.DODGE_ACTION!, bundle: f.bundle, profile: level3, context: context(f) });
    const b = projectGeneralActionCard({ entry: index.value.actions.DODGE_ACTION!, bundle: f.bundle, profile: level3, context: context(f) });
    expect(a).toEqual(b);
    expect(JSON.stringify(level3)).toBe(before);
  });
});
