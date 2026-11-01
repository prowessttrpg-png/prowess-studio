/**
 * M6-WO6 negative / mutation controls (PAS-10 M6-WO6 §172) on the shared CLOSEOUT-03 harness: each control mutates REAL
 * source (code, schema or the baseline content), the permanent M6-WO6 guard must FAIL for a behavioural reason, and the
 * file is restored byte-for-byte. Guards (one green baseline each): the @prowess/game Weapon & Attack suites, and the
 * M6-WO6 static gate with the Weapon UI suite (Studio). Invariants: M6-I057 … M6-I076.
 */
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runControls, vitestGuard } from "./lib/control-harness.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const game = vitestGuard(root, "packages/prowess-game", ["src/weapon-library.test.ts", "src/weapon-bridge.test.ts", "src/weapon-definitions.test.ts", "src/weapon-catalog-completeness.test.ts", "src/m6-wo6-registry.test.ts"], { timeout: 600_000, ciEnv: false });
const studio = vitestGuard(root, "apps/studio", ["tests/unit/m6-wo6-static.test.ts", "tests/unit/m6-wo6-weapon-ui.test.tsx"], { timeout: 300_000, ciEnv: false });

const replace = (...pairs) => (text) => {
  let out = text;
  for (let i = 0; i < pairs.length; i += 2) {
    const [from, to] = [pairs[i], pairs[i + 1]];
    assert.equal(out.split(from).length, 2, `one exact mutation anchor: ${from}`);
    out = out.replace(from, to);
  }
  return out;
};
const append = (extra) => (text) => `${text}\n${extra}\n`;
/** Edits the baseline content as data (parse → change → serialize); the original bytes are restored by the harness. */
const content = (edit) => (text) => {
  const d = JSON.parse(text);
  const byKey = (k) => {
    const x = d.definitions.find((e) => e.canonicalKey === k);
    assert.ok(x, `content entry ${k}`);
    return x.payload;
  };
  edit(byKey, d);
  return `${JSON.stringify(d, null, 2)}\n`;
};

const G = (f) => `packages/prowess-game/src/${f}`;
const PAYLOAD = G("definition/equipment-payload.ts");
const CATALOG = G("equipment/catalog.ts");
const DAMAGE = G("equipment/damage.ts");
const LIBRARY = G("equipment/library.ts");
const LOADOUT = G("equipment/loadout.ts");
const BRIDGE = G("equipment/bridge.ts");
const CONTENT = G("content/core-playtest-v0.1/weapons.json");
const SERVICE = "packages/prowess-db/src/character/weapon-service.ts";
const REPO = "packages/prowess-db/src/character/weapon-repository.ts";
const REFERENCE = "packages/prowess-db/src/weapon-library/service.ts";
const SCHEMA = "packages/prowess-db/prisma/schema.prisma";
const WO6_END = "// <<< M6-WO6 Character weapon loadout";
const MOVESET_LOOKUP = "      const a = findBundleDefinition(bundle, attackRef);";
const WEAPON_PROPS = '    const weaponProperties = payload.weaponProperties.map((u) => resolveUse(bundle, u, "WEAPON_PROPERTY", ref, add));';
const PROJECT_DAMAGE = "  const damage = attack.payload.damageProfiles.map((d) => previewAttackDamage({ weapon, attack, profile: d, grip, stats,";

const controls = [
  // ---- Exact Attack identity (M6-I057, M6-I065) ----
  ["1 generic Weapon Attack introduced", LIBRARY, append('export const GENERIC_WEAPON_ATTACK = { moveKey: "ATTACK", apCost: 2 } as const;'), studio],
  ["2 Attack identified by name", CATALOG, replace(MOVESET_LOOKUP, "      const a = bundle.definitions.find((d) => d.displayName === attackRef.canonicalKey) ?? null;"), studio],
  // ---- Exact Release refs (M6-I064, M6-I076) ----
  ["3 latest Weapon revision lookup", SERVICE, append("export const latestWeaponRevision = async (entityId: string) => (await import(\"../client.js\")).prisma.entityVersion.findFirst({ where: { entityId }, orderBy: { revisionNumber: \"desc\" } });"), studio],
  ["4 latest Attack revision lookup", REFERENCE, append("export const getLatestAttackRevision = (versions: readonly { revisionNumber: number }[]) => versions.at(-1);"), studio],
  ["5 cross-Release Weapon equipped", LOADOUT, replace("    const weapon = findLibraryWeapon(index, selection);", "    const weapon = index.weapons.find((w) => w.ref.entityId === selection.entityId) ?? null;"), game],
  ["6 cross-Release Attack in Moveset", CATALOG, replace(MOVESET_LOOKUP, "      const a = bundle.definitions.find((d) => d.entityId === attackRef.entityId) ?? null;"), game],
  ["7 Weapon references Attack from another family", CATALOG, replace("      if (attack.weaponFamilyKey !== payload.familyKey) add(", "      if (false) add("), game],
  ["8 duplicate Attack in Moveset", PAYLOAD, replace('  unique(moveset.map((m) => m.entityId), [...at, "moveset"], p, "Moveset Attacks");\n', ""), game],
  // ---- Move AP, scaling and damage (M6-I058 … M6-I063) ----
  ["9 Move AP inferred from Category", LIBRARY, replace("    apCost: attack.payload.apCost,", '    apCost: weapon.payload.category === "HEAVY" ? 3 : weapon.payload.category === "BALANCED" ? 2 : 1,'), game],
  ["10 STATIC Weapon given Power", PAYLOAD, replace('  if (scalingModel === "STATIC" && rawPower !== null) p.add(', '  if (false) p.add('), game],
  ["11 STATIC damage STR-scaled", DAMAGE, replace('  if (attack.scaling === "STATIC") {', '  if (attack.scaling === "STATIC" && request.stats.STR === undefined) {'), game],
  ["12 POWER Weapon missing Power", PAYLOAD, replace('  if (scalingModel === "POWER" && rawPower === null) p.add(', '  if (false) p.add('), game],
  ["13 Power below 2", PAYLOAD, replace("const MINIMUM_AUTHORED_POWER = 2;", "const MINIMUM_AUTHORED_POWER = 1;"), game],
  ["14 HYBRID Move scaling inferred", CATALOG, replace("        if (attack.scaling === null) add(K.HYBRID_SCALING,", "        if (false) add(K.HYBRID_SCALING,", "        scaling = attack.scaling;", '        scaling = attack.scaling ?? (payload.power === null ? "STATIC" : "POWER");'), game],
  ["15 full base dice expression not repeated", CONTENT, content((k) => { k("equipment.trait.power_scaling").contract.diceCount.expression = "base_count + multiplier - 1"; }), game],
  ["16 Versatile step applied after Power multiplication", CONTENT, content((k) => { k("equipment.trait.versatile").contract.order = "AFTER_POWER"; }), game],
  ["17 arbitrary multi-die Versatile conversion guessed", DAMAGE, replace("    if (base.count !== ONE_DIE) return fail(", "    if (base.count === 0) return fail("), game],
  // ---- Loadout (M6-I066 … M6-I068) ----
  ["18 two-handed Weapon allows off-hand", LOADOUT, replace('      if (h === "TWO_HANDED") issues.push({ code: L.HANDS,', '      if (false) issues.push({ code: L.HANDS,'), game],
  ["19 Shield treated as Dual Wield", LIBRARY, replace('    if (e.weapon.payload.equipmentRole === "SHIELD") reasons.push(', "    if (false) reasons.push("), game],
  ["20 illegal Shield requirement accepted", LOADOUT, replace("      if (r.satisfied === false) issues.push({ code: L.REQUIREMENT,", "      if (r.satisfied === false && r.kind !== \"MARTIAL_RANK_AT_LEAST\") issues.push({ code: L.REQUIREMENT,"), game],
  ["21 Heavy Bow STR requirement ignored", CONTENT, content((k) => { k("weapon.heavy_bow").requirements = []; }), game],
  ["22 stale loadout accepted", REPO, replace("      const claimed = await tx.characterWeaponLoadout.updateMany({ where: { characterId, lockVersion: expected }, data:", "      const claimed = await tx.characterWeaponLoadout.updateMany({ where: { characterId }, data:"), studio],
  ["23 Weapon loadout mutates advancement history", REPO, replace("      const claimed = await tx.characterWeaponLoadout.updateMany(", "      await tx.characterAdvancement.updateMany({ where: { characterId }, data: {} });\n      const claimed = await tx.characterWeaponLoadout.updateMany("), studio],
  ["24 equipped Shield bonuses persisted as derived totals", SCHEMA, replace('  mainHandGrip            String?        @map("main_hand_grip")\n', '  mainHandGrip            String?        @map("main_hand_grip")\n  armorTotal              Int?           @map("armor_total")\n'), studio],
  // ---- Ammunition stays authored data (M6-I073) ----
  ["25 Ammo runtime table introduced", SCHEMA, replace(WO6_END, "model CharacterAmmunition {\n  characterId String @id @db.Uuid\n  rounds Int\n}\n" + WO6_END), studio],
  ["26 reserve ammunition invented", LIBRARY, append("export const reserveAmmo = (loading: number) => ({ reserveAmmo: loading });"), studio],
  ["27 Reload progress persisted", SCHEMA, replace('  lockVersion Int      @default(1) @map("lock_version")\n  updatedAt   DateTime @default(now()) @map("updated_at") @db.Timestamptz(6)\n\n  @@index([mainHandEntityVersionId]', '  lockVersion Int      @default(1) @map("lock_version")\n  reloadProgress Int   @default(0) @map("reload_progress")\n  updatedAt   DateTime @default(now()) @map("updated_at") @db.Timestamptz(6)\n\n  @@index([mainHandEntityVersionId]'), studio],
  ["28 Loud inferred solely from Category", CATALOG, replace(WEAPON_PROPS, '    const weaponProperties = payload.weaponProperties.map((u) => resolveUse(bundle, u, "WEAPON_PROPERTY", ref, add)).filter((u) => u?.traitKey !== "LOUD" || payload.category === "HEAVY");'), game],
  ["29 Crossbow forced Loud", CONTENT, content((k) => { k("weapon.light_crossbow").weaponProperties.push({ ...k("weapon.rifle").weaponProperties.find((u) => u.traitRef.$ref === "equipment.trait.loud") }); }), game],
  // ---- Auto / Burst (§37, §46) ----
  ["30 Auto converted to Attack Roll", CONTENT, content((k) => { k("attack.smg.suppress").resolution = { mode: "ATTACK_ROLL", onMiss: "NO_DAMAGE" }; }), game],
  ["31 Auto success / failure inverted", CONTENT, content((k, d) => {
    const auto = k("equipment.trait.auto").contract;
    [auto.onFailure, auto.onSuccess] = [auto.onSuccess, auto.onFailure];
    for (const e of d.definitions) if (e.definitionKind === "ATTACK" && e.payload.resolution.mode === "SAVING_THROW") [e.payload.resolution.onFailure, e.payload.resolution.onSuccess] = [e.payload.resolution.onSuccess, e.payload.resolution.onFailure];
  }), game],
  ["32 Burst bonus applied twice", LIBRARY, replace(PROJECT_DAMAGE, '  const damage = attack.payload.damageProfiles.map((d) => previewAttackDamage({ weapon, attack, profile: attack.moveProperties.some((u) => u?.contract?.kind === "AUTHORED_BURST") ? { ...d, dice: { ...d.dice, count: d.dice.count + 1 } } : d, grip, stats,'), game],
  // ---- Dual Wield (M6-I070, M6-I071) ----
  ["33 dual AP summed rather than max", CONTENT, content((k) => { k("equipment.trait.dual_wield").contract.sequenceCost.expression = "ap_a + ap_b"; }), game],
  ["34 dual Attacks merged into one", LIBRARY, replace("attacks: [pa, pb] as [CharacterAttack, CharacterAttack]", "attacks: [pa, pa] as [CharacterAttack, CharacterAttack]"), game],
  ["35 dual sequence treated as Powerful Blow", LIBRARY, replace("powerfulBlow: false as const", "powerfulBlow: true as unknown as false"), studio],
  ["36 cumulative dual Power omitted", CONTENT, content((k) => { k("equipment.trait.dual_wield").contract.effectivePower.expression = "power + adjustment"; }), game],
  // ---- Unarmed (M6-I072) ----
  ["37 Unarmed persisted as mutable Weapon state", REPO, replace("    mainHandGrip: choice.mainHandGrip,\n", "    mainHandGrip: choice.mainHandGrip,\n    unarmedEntityVersionId: choice.mainHand?.entityVersionId ?? null,\n"), studio],
  ["38 Master Unarmed Reinforced omitted", LIBRARY, replace("    moveProperties: attack.moveProperties,\n    notExecuted,", '    moveProperties: request.hand === "UNARMED" ? [] : attack.moveProperties,\n    notExecuted,'), game],
  // ---- Maneuver bridge (M6-I075) ----
  ["39 Attack bridge drops Weapon provenance", BRIDGE, replace("      provenance: attack.provenance,\n", "      provenance: null as never,\n"), game],
  ["40 Attack bridge changes AP", BRIDGE, replace('{ contributionKey: "foundation.ap", currency: "AP", data: { kind: "FIXED", amount: attack.apCost } }', '{ contributionKey: "foundation.ap", currency: "AP", data: { kind: "FIXED", amount: 1 } }'), game],
  ["41 Attack bridge applies STR to firearm", BRIDGE, replace('    preview.scaling === "STATIC" || preview.power === null', '    preview.power === null && preview.scaling !== "STATIC"'), game],
  // ---- Properties (§18, §21) ----
  ["42 Rules Text parsed for property", CATALOG, append("export const pierceFromText = (summary: string) => Number(summary.match(/Ignore (\\d+)/)?.[1] ?? 0);"), studio],
  ["43 property marked executable without full contract", PAYLOAD, replace('  if (executionStatus === "EXECUTABLE") contract = readContract(rawContract, [...at, "contract"], p);', '  if (executionStatus === "EXECUTABLE" && rawContract !== null) contract = readContract(rawContract, [...at, "contract"], p);'), game],
  // ---- Scope boundaries (§7, §139) ----
  ["44 ARMOR activated accidentally", G("vocabulary/families.ts"), replace('  ARMOR: reserved("EQUIPMENT"),', '  ARMOR: active("EQUIPMENT"),'), studio],
  ["45 full inventory domain introduced", SCHEMA, replace(WO6_END, "model CharacterInventoryItem {\n  id String @id @db.Uuid\n  characterId String @db.Uuid\n}\n" + WO6_END), studio],
  ["46 frontend calculates Power scaling", "apps/studio/app/characters/_lib/weapon-format.ts", replace("  return d.final !== null ? `${d.final.expression} ${type}` :", "  return d.final !== null ? `${d.base.count * (d.multiplier ?? 1)}d${d.base.sides} ${type}` :"), studio],
  ["47 Character Sheet uses hard-coded Weapon catalog", "apps/studio/app/characters/_components/sheet/WeaponPanels.tsx", append('export const SHEET_WEAPONS = ["Long Blade", "Rifle", "Light Shield"] as const;'), studio],
  ["48 baseline catalog stored as runtime code constants", G("index.ts"), append('export { WEAPON_DEFINITIONS } from "./testing/weapon-fixtures.js";'), studio],
  // ---- Additional risks found during implementation ----
  ["49 range formula duplicated in game code", LIBRARY, replace("      const feet = score === undefined ? null : rangedFeet(t.feetPerPoint, score);", "      const feet = score === undefined ? null : t.feetPerPoint * score;"), studio],
  ["50 client submits derived damage on the loadout write", "apps/studio/app/api/characters/[characterId]/weapon-loadout/route.ts", replace('readStrictBody(request, ["expectedVersion", "mainHand", "mainHandGrip", "offHand"])', 'readStrictBody(request, ["expectedVersion", "mainHand", "mainHandGrip", "offHand", "damage"])'), studio],
  ["51 M5 STATIC foundation accepts a fake Power", G("definition/authored-ability-payload.ts"), replace('  if (isStatic && (own(damage, "power") !== null || own(damage, "stat") !== null)) p.add(', "  if (false) p.add("), game],
  ["52 reference-only property silently executed", LIBRARY, replace('  const notExecuted = [...weapon.weaponProperties, ...attack.moveProperties].filter((u) => u.executionStatus !== "EXECUTABLE").map((u) => u.traitKey);', "  const notExecuted: string[] = [];"), game],
  ["53 Unarmed profile not derived from the current Martial rank", LIBRARY, replace('w.payload.profileKind === "UNARMED" && w.payload.martialRankKey === martial.rankKey', 'w.payload.profileKind === "UNARMED" && w.payload.martialRankKey === "UNTRAINED"'), game],
];

runControls({
  root,
  title: "M6-WO6",
  controls: controls.map(([name, file, mutate, guard]) => ({ name, file, mutate, guard })),
  expect: /AssertionError|expected|failed/i,
  caught: (name) => `Caught and restored: ${name}`,
  done: (count) => `All ${count} M6-WO6 controls caught and restored.`,
});
