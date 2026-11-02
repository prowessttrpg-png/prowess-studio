import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import catalog from "./fixtures/m6-wo1-catalog.json";
import { laterMigrations } from "./later-milestone-schema";
import { auditM5Source } from "./m5-wo1-audit-helpers";

/**
 * M6-WO6 gate — Weapon & Attack Library (PAS-10 M6-WO6 §169–§172). Static architecture assertions over the real
 * sources; the behaviour is guarded by the @prowess/game weapon suites, the @prowess/db and Studio integration suites,
 * the WO6 UI suite and scripts/m6-wo6-negative-controls.mjs (shared CLOSEOUT-03 harness).
 *
 * Invariants: M6-I057 exact Attack identity · M6-I058 Moves own AP · M6-I059 Weapon / Move properties distinct ·
 * M6-I060 explicit POWER / STATIC / HYBRID · M6-I061 STATIC never uses Power · M6-I062 the full base expression repeats ·
 * M6-I063 Power never below 2 · M6-I064 Release-scoped refs · M6-I065 display names are never identity · M6-I066 the
 * loadout cannot mutate Release identity · M6-I067 Two-Handed occupies both hands · M6-I068 explicit Versatile grip ·
 * M6-I069 shield modifiers are derived · M6-I070 Dual Wield keeps two exact Attacks · M6-I071 Dual Wield is not Powerful
 * Blow · M6-I072 Unarmed from Martial rank · M6-I073 ammunition definitions ≠ runtime state · M6-I074 preview never
 * spends or deals damage · M6-I075 the Maneuver binding reuses the exact Attack contract · M6-I076 no latest lookup.
 */
const ROOT = path.resolve(process.cwd(), "..", "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const hash = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
function walk(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).flatMap((e) => {
    const rel = `${dir}/${e}`;
    return statSync(path.join(ROOT, rel)).isDirectory() ? walk(rel) : [rel];
  });
}
const code = (dir: string) => walk(dir).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f));
const fn = (src: string, name: string) => {
  const start = src.search(new RegExp(`export (async )?function ${name}\\(`));
  expect(start, `${name} exists`).toBeGreaterThanOrEqual(0);
  const end = src.indexOf("\n}\n", start);
  return src.slice(start, end < 0 ? undefined : end + 2);
};

const GAME_DIR = "packages/prowess-game/src";
const WO6_GAME = ["definition/equipment-payload.ts", "equipment/bridge.ts", "equipment/catalog.ts", "equipment/damage.ts", "equipment/library.ts", "equipment/loadout.ts", "vocabulary/equipment.ts"].map((f) => `${GAME_DIR}/${f}`);
const PAYLOAD = strip(read(`${GAME_DIR}/definition/equipment-payload.ts`));
const CATALOG = strip(read(`${GAME_DIR}/equipment/catalog.ts`));
const DAMAGE = strip(read(`${GAME_DIR}/equipment/damage.ts`));
const LIBRARY = strip(read(`${GAME_DIR}/equipment/library.ts`));
const LOADOUT = strip(read(`${GAME_DIR}/equipment/loadout.ts`));
const BRIDGE = strip(read(`${GAME_DIR}/equipment/bridge.ts`));
const VOCAB = strip(read(`${GAME_DIR}/vocabulary/equipment.ts`));
const FAMILIES = strip(read(`${GAME_DIR}/vocabulary/families.ts`));
const ADVANCEMENT = strip(read(`${GAME_DIR}/character/advancement.ts`));
const SERVICE = strip(read("packages/prowess-db/src/character/weapon-service.ts"));
const REPOSITORY = strip(read("packages/prowess-db/src/character/weapon-repository.ts"));
const SHEET_SERVICE = strip(read("packages/prowess-db/src/character/sheet-service.ts"));
const REFERENCE = strip(read("packages/prowess-db/src/weapon-library/service.ts"));
const CONTENT_PATH = `${GAME_DIR}/content/core-playtest-v0.1/weapons.json`;
const CONTENT = JSON.parse(read(CONTENT_PATH)) as { definitions: Array<{ canonicalKey: string; definitionKind: string; displayName: string; payload: Record<string, unknown> }> };
const WEAPONS = CONTENT.definitions.filter((d) => d.definitionKind === "WEAPON");
const ATTACKS = CONTENT.definitions.filter((d) => d.definitionKind === "ATTACK");
const TRAITS = CONTENT.definitions.filter((d) => d.definitionKind === "EQUIPMENT_TRAIT");

const SCHEMA_PATH = "packages/prowess-db/prisma/schema.prisma";
const SCHEMA = read(SCHEMA_PATH);
const WO6_BLOCK = SCHEMA.slice(SCHEMA.indexOf("// >>> M6-WO6"), SCHEMA.indexOf("// <<< M6-WO6")).replace(/^\s*\/\/.*$/gm, "");
const MIGRATION_NAME = "20261102010000_m6_wo6_character_weapon_loadout";
const MIGRATION = read(`packages/prowess-db/prisma/migrations/${MIGRATION_NAME}/migration.sql`);
const BASELINE = JSON.parse(read("docs/architecture/m6-wo6-baseline.json")) as { baseCommit: string; frozenFiles: Record<string, string> };

const ROUTES = [
  "apps/studio/app/api/characters/[characterId]/attacks/route.ts",
  "apps/studio/app/api/characters/[characterId]/weapon-loadout/route.ts",
  "apps/studio/app/api/characters/[characterId]/weapons/route.ts",
  "apps/studio/app/api/compendium-reference/rulesets/[rulesetId]/releases/[releaseId]/attacks/route.ts",
  "apps/studio/app/api/compendium-reference/rulesets/[rulesetId]/releases/[releaseId]/weapons/route.ts",
];
const CHARACTER_UI = code("apps/studio/app/characters");
const WEAPON_UI = ["apps/studio/app/characters/_components/sheet/WeaponPanels.tsx", "apps/studio/app/characters/_components/AttackLibraryPanel.tsx", "apps/studio/app/characters/_lib/weapon-format.ts", "apps/studio/app/compendium/rulesets/_components/WeaponLibrary.tsx", "apps/studio/app/compendium/admin/_components/WeaponEditors.tsx"];
const LATEST = /latest|newest|mostRecent|findFirst|orderBy|current\w*(Release|Revision|Version)|getCurrent/i;

describe("M6-WO6 gate — Definition kinds (§8–§18, §170)", () => {
  it("WEAPON and EQUIPMENT_TRAIT are activated, ATTACK is added, ARMOR stays reserved — exactly", () => {
    expect(FAMILIES).toMatch(/WEAPON: active\("EQUIPMENT"\),/);
    expect(FAMILIES).toMatch(/ATTACK: active\("EQUIPMENT"\),/);
    expect(FAMILIES).toMatch(/EQUIPMENT_TRAIT: active\("EQUIPMENT"\),/);
    expect(FAMILIES).toMatch(/ARMOR: reserved\("EQUIPMENT"\),/);
    const kinds = catalog.kinds as Array<{ definitionKind: string; supportedSchemaVersions: number[] }>;
    for (const k of ["WEAPON", "ATTACK", "EQUIPMENT_TRAIT"]) expect(kinds.find((x) => x.definitionKind === k)?.supportedSchemaVersions, k).toEqual([1]);
    expect(kinds.find((x) => x.definitionKind === "ARMOR")?.supportedSchemaVersions).toEqual([]);
    expect(PAYLOAD).toMatch(/export const EQUIPMENT_PAYLOAD_KINDS = Object\.freeze\(\["WEAPON", "ATTACK", "EQUIPMENT_TRAIT"\] as const\);/);
  });

  it("M6-I060 every Weapon declares POWER, STATIC or HYBRID; STATIC carries no Power; Power is at least 2 (M6-I061, M6-I063)", () => {
    expect(VOCAB).toMatch(/WEAPON_SCALING_MODELS = deepFreeze\(\["POWER", "STATIC", "HYBRID"\] as const\);/);
    expect(VOCAB).toMatch(/ATTACK_SCALINGS = deepFreeze\(\["POWER", "STATIC"\] as const\);/);
    for (const w of WEAPONS) {
      const p = w.payload as { scalingModel: string; power: number | null; scalingRule: unknown };
      expect(["POWER", "STATIC", "HYBRID"], w.canonicalKey).toContain(p.scalingModel);
      if (p.scalingModel === "STATIC") expect([p.power, p.scalingRule], w.canonicalKey).toEqual([null, null]);
      else if (p.power !== null || p.scalingModel === "POWER") expect(p.power, w.canonicalKey).toBeGreaterThanOrEqual(2); // a HYBRID whose Moves are all STATIC may carry none
    }
    for (const a of ATTACKS) expect(["POWER", "STATIC", null], a.canonicalKey).toContain((a.payload as { scaling: string | null }).scaling);
  });

  it("M6-I057 / M6-I058 every Move is an exact authored ATTACK with its own AP; no generic Weapon Attack exists", () => {
    expect(WEAPONS.length).toBe(47);
    expect(ATTACKS.length).toBe(141);
    expect(TRAITS.length).toBe(38);
    for (const w of WEAPONS) {
      const moves = (w.payload as { moveset: Array<{ $ref: string }> }).moveset;
      expect(moves.length, w.canonicalKey).toBeGreaterThan(0);
      for (const m of moves) expect(m.$ref, w.canonicalKey).toMatch(/^attack\.[a-z0-9_]+\.[a-z0-9_]+$/);
      expect(new Set(moves.map((m) => m.$ref)).size, w.canonicalKey).toBe(moves.length);
    }
    for (const a of ATTACKS) expect(Number.isSafeInteger((a.payload as { apCost: number }).apCost), a.canonicalKey).toBe(true);
    for (const d of CONTENT.definitions) expect(`${d.canonicalKey} ${d.displayName}`).not.toMatch(/generic|weapon attack$|basic attack/i);
    for (const f of [...WO6_GAME, ...code("packages/prowess-db/src/character"), ...code("packages/prowess-db/src/weapon-library")]) {
      expect(strip(read(f)), f).not.toMatch(/GENERIC_WEAPON_ATTACK|genericWeaponAttack|defaultAttack|Weapon Attack"/);
    }
    // The Move's AP is read from the exact ATTACK; never derived from a category, handedness or family.
    expect(LIBRARY).toMatch(/apCost: attack\.payload\.apCost,\n\s+mpCost: attack\.payload\.mpCost,/);
    expect([LIBRARY, CATALOG, BRIDGE].join("\n")).not.toMatch(/category\w*\s*(===|\?)[^\n]*apCost|AP_BY_CATEGORY|apFor(Category|Handedness)/);
  });

  it("M6-I059 Weapon properties and Move properties are distinct trait use sites", () => {
    expect(VOCAB).toMatch(/TRAIT_USE_SITES = deepFreeze\(\["WEAPON_PROPERTY", "MOVE_PROPERTY"\] as const\);/);
    expect(CATALOG).toMatch(/payload\.weaponProperties\.map\(\(u\) => resolveUse\(bundle, u, "WEAPON_PROPERTY", ref, add\)\)/);
    expect(CATALOG).toMatch(/attack\.moveProperties\.map\(\(u\) => resolveUse\(bundle, u, "MOVE_PROPERTY", attackRef2, add\)\)/);
    expect(CATALOG).toMatch(/if \(!trait\.useSites\.includes\(site\)\) \{/);
  });

  it("§18 a trait is executable only with a complete contract; reference-only traits are preserved, never executed", () => {
    expect(PAYLOAD).toMatch(/contract/);
    for (const t of TRAITS) {
      const p = t.payload as { executionStatus: string; contract: unknown };
      if (p.executionStatus === "EXECUTABLE") expect(p.contract, t.canonicalKey).not.toBeNull();
      else expect(p.contract ?? null, t.canonicalKey).toBeNull();
    }
    // No rules text is ever parsed for a property (§21).
    for (const f of WO6_GAME) expect(strip(read(f)), f).not.toMatch(/rulesText|summary\.(match|includes|split)|\.summary\s*\.test|new RegExp/);
  });
});

describe("M6-WO6 gate — @prowess/game library purity (§25–§55, §83–§85, §170)", () => {
  it("the WO6 game files pass the M5-WO1 audit with exactly the documented allowances", () => {
    // Allowances (and nothing else): the authored Move AP / MP field names, the exact held-Weapon field of a resolved
    // hand, and the Attack targeting modes LINE / CONE (Attack geometry, not the M5 Targeting shapes).
    for (const f of WO6_GAME) {
      const src = read(f).replace(/\b(apCost|mpCost)\b/g, "moveCost").replace(/\.weapon\b/g, ".heldWeapon").replace(/"(LINE|CONE)"/g, '"$1_TARGETING"');
      expect(auditM5Source(src, f, "game"), f).toEqual([]);
    }
  });

  it("no duplicated formula: Power, the multiplier, repeated dice, Dual Wield AP / Power and ranges all go through M4", () => {
    for (const f of WO6_GAME) {
      const src = strip(read(f));
      expect(src, f).not.toMatch(/Math\.|floor\(|ceil\(|\bmax\(|\bmin\(/);
      expect(src, f).not.toMatch(/expression:\s*["'`]/); // Formulas are Release content, never a code string
    }
    expect(DAMAGE).toMatch(/const response = evaluateFormula\(\{ expression: slot\.expression, rounding: "NONE" \}, \{ \.\.\.bindings \}\);/);
    expect(DAMAGE).toMatch(/const multiplier = evaluateSlot\(contract\.multiplier, \{ stat_score: statScore, power: adjusted, minimum_power: contract\.minimumPower \}\);/);
    expect(DAMAGE).toMatch(/const count = evaluateSlot\(contract\.diceCount, \{ base_count: rolled\.count, multiplier \}\);/);
    expect(LIBRARY).toMatch(/const apCost = evaluateSlot\(rule\.contract\.sequenceCost, \{ ap_a: a\.payload\.apCost, ap_b: b\.payload\.apCost \}\);/);
    expect(LIBRARY).toMatch(/evaluateModifiers|rangedFeet/);
  });

  it("M6-I061 / M6-I062 STATIC returns the authored dice; POWER repeats the full (grip-adjusted) base expression; Versatile steps first", () => {
    const versatile = DAMAGE.indexOf('if (weapon.payload.handedness === "VERSATILE" && grip === "TWO_HANDED") {');
    const staticStep = DAMAGE.indexOf('if (attack.scaling === "STATIC") {');
    const power = DAMAGE.indexOf("const multiplier = evaluateSlot(");
    expect(versatile).toBeGreaterThan(0);
    expect(staticStep).toBeGreaterThan(versatile);
    expect(power).toBeGreaterThan(staticStep);
    expect(DAMAGE.slice(staticStep, power)).toMatch(/return out\(\{ gripAdjusted, final: rolled \}\);/);
    expect(DAMAGE).toMatch(/if \(base\.count !== ONE_DIE\) return fail\(/); // §31 multi-die Versatile fails closed
    expect(DAMAGE).toMatch(/const final = dice\(count, rolled\.sides\);/);
  });

  it("M6-I067 / M6-I068 hands and grips are validated by the domain loadout reader; Unarmed is never equipped (M6-I072)", () => {
    for (const code_ of ["INVALID_INPUT", "NOT_PINNED", "NOT_EQUIPPABLE", "GRIP", "HANDS", "REQUIREMENT", "UNRESOLVED"]) expect(LOADOUT, code_).toContain(code_);
    expect(LOADOUT).toMatch(/UNARMED/);
    expect(LIBRARY).toMatch(/martialRank/);
    expect(REPOSITORY).not.toMatch(/unarmed/i); // Unarmed is derived from the Martial rank, never stored
  });

  it("M6-I069 shield modifiers enter the ONE profile builder as named, sourced equipment bonuses — never stored totals", () => {
    expect(ADVANCEMENT).toMatch(/bonusKey: `equipment_\$\{/);
    expect(ADVANCEMENT).toMatch(/category: "EQUIPMENT"/);
    expect([...ADVANCEMENT.matchAll(/export function buildCharacterMechanicalProfile\(/g)]).toHaveLength(1);
    expect(WO6_BLOCK).not.toMatch(/armor|dodge|movement|bonus|total|power|damage|attack|ammo|ammunition|reload|loaded|rounds|inventory|owned|quantity/i);
  });

  it("M6-I070 / M6-I071 Dual Wield keeps two exact Attacks with the Release's AP Formula and is never a Powerful Blow", () => {
    expect(LIBRARY).toMatch(/attacks: \[pa, pb\] as \[CharacterAttack, CharacterAttack\], powerfulBlow: false as const/);
    expect([LIBRARY, BRIDGE].join("\n")).not.toMatch(/POWERFUL_BLOW|powerfulBlow: true|resolutionGroups/);
  });

  it("M6-I074 preview never rolls, spends or applies — the library is pure", () => {
    for (const f of WO6_GAME) expect(strip(read(f)), f).not.toMatch(/Math\.random|crypto|randomInt|\broll\(|spend\w*\(|applyDamage|currentHp|resourceState|Date\.now|new Date/);
  });

  it("M6-I075 the Maneuver binding reuses the M5 foundation reader and the MANEUVER_FOUNDATION payload contract", () => {
    expect(BRIDGE).toMatch(/import \{ readFoundationProfile, type AttackFoundationProfile \} from "\.\.\/definition\/authored-ability-payload\.js";/);
    expect(BRIDGE).toMatch(/const foundation = readFoundationProfile\(\{ attack: rulesAttack \}, \["rules"\], p\);/);
    expect(BRIDGE).toMatch(/readDefinitionPayload\("MANEUVER_FOUNDATION", "FOUNDATION", /);
    expect(BRIDGE).toMatch(/\{ contributionKey: "foundation\.ap", currency: "AP", data: \{ kind: "FIXED", amount: attack\.apCost \} \}/);
    expect(BRIDGE).toMatch(/scaling: "STATIC", weaponKey: attack\.weapon\.canonicalKey, baseDice: rolledBase\.expression, power: null, stat: null/);
    expect(BRIDGE).not.toMatch(/stat: "STR"|power: 0\b/);
  });

  it("M6-I073 ammunition, Loading, Reload and Loud are authored data only; Crossbows are never Loud", () => {
    for (const f of [...WO6_GAME, ...code("packages/prowess-db/src/character")]) expect(strip(read(f)), f).not.toMatch(/ammoRemaining|roundsLoaded|reserveAmmo|reloadProgress|currentAmmo|magazine/i);
    const loud = TRAITS.find((t) => t.canonicalKey === "equipment.trait.loud");
    expect(loud).toBeDefined();
    for (const w of WEAPONS.filter((x) => /crossbow/.test(x.canonicalKey))) expect(JSON.stringify(w.payload.weaponProperties), w.canonicalKey).not.toContain("equipment.trait.loud");
  });

  it("the baseline catalog is Release content, never runtime code: only the test fixtures read weapons.json", () => {
    const packages = readdirSync(path.join(ROOT, "packages")).flatMap((p) => code(`packages/${p}/src`));
    const importers = [...packages, ...code("apps/studio/app"), ...code("apps/studio/src")].filter((f) => read(f).includes("weapons.json"));
    expect(importers).toEqual(["packages/prowess-game/src/testing/weapon-fixtures.ts"]);
    expect(read(`${GAME_DIR}/index.ts`)).not.toMatch(/weapon-fixtures|weapons\.json/);
  }, 60_000);
});

describe("M6-WO6 gate — exact Release identity (§13, §94–§96, M6-I064 M6-I065 M6-I066 M6-I076)", () => {
  it("M6-I065 no display name and no canonical-key lookup in the library, loadout, service or reference read", () => {
    for (const f of [...WO6_GAME, "packages/prowess-db/src/character/weapon-service.ts", "packages/prowess-db/src/weapon-library/service.ts"]) {
      const src = strip(read(f));
      expect(src, f).not.toMatch(/displayName\s*===|\.displayName\s*\)|find\([^)]*displayName|find\([^)]*canonicalKey ===|canonicalKey === [a-z]/);
    }
    expect(CATALOG).toMatch(/isSameExactDefinition|findBundleDefinition/);
  });

  it("M6-I076 no latest / current revision lookup anywhere in the WO6 path", () => {
    for (const f of [...WO6_GAME, "packages/prowess-db/src/character/weapon-service.ts", "packages/prowess-db/src/character/weapon-repository.ts", "packages/prowess-db/src/weapon-library/service.ts", ...ROUTES]) {
      expect(strip(read(f)), f).not.toMatch(LATEST);
    }
  });

  it("M6-I066 the loadout write touches only the loadout table, compare-and-set; the Character row, history and Release never change", () => {
    expect([...REPOSITORY.matchAll(/prisma\.(\w+)\./g)].map((m) => m[1])).toEqual(["characterWeaponLoadout", "characterWeaponLoadout"]);
    expect(REPOSITORY).toMatch(/const claimed = await tx\.characterWeaponLoadout\.updateMany\(\{ where: \{ characterId, lockVersion: expected \}, data:/);
    expect(REPOSITORY).not.toMatch(/tx\.(character|characterAdvancement|characterSheetNotes|characterPlayState|entityVersion|ruleset\w*)\.(update|create|delete|upsert)/);
    const update = fn(SERVICE, "updateCharacterWeaponLoadout");
    expect(update).toMatch(/STALE_WRITE|stale/);
    expect(update).toMatch(/INVALID_LOADOUT/);
    expect(update).not.toMatch(/rulesetReleaseId|releaseId:/);
  });

  it("the sheet and the Attack Library read the ONE profile rebuilt from the Character's own Release", () => {
    expect(SERVICE).toMatch(/const \{ c, bundle, ruleset, history, progression \} = await loadCompleted\(id\);\n\s+const base = requireProfile\(profileOf\(bundle, ruleset, progression\)\);/);
    expect(SERVICE).toMatch(/const profile = equipment === null \? base : requireProfile\(profileOf\(bundle, ruleset, progression, equipment\)\);/);
    expect(SHEET_SERVICE).toMatch(/const state = await loadEquippedCharacter\(id\);/);
    expect(REFERENCE).toMatch(/requireRelease/);
  });
});

describe("M6-WO6 gate — registered schema change and migration (§140–§143, §174)", () => {
  it("the registry entry is exactly the loadout model and the one WO6 migration, after WO5", () => {
    const registry = JSON.parse(read("docs/architecture/m6-schema-changes.json")) as Record<string, unknown>;
    expect(registry["M6-WO6"]).toEqual({ migrations: [MIGRATION_NAME], models: ["CharacterWeaponLoadout"] });
    const later = laterMigrations();
    expect(later.indexOf(MIGRATION_NAME)).toBe(later.indexOf("20261101010000_m6_wo5_character_sheet_state") + 1);
    expect([...WO6_BLOCK.matchAll(/^model (\w+) \{/gm)].map((m) => m[1])).toEqual(["CharacterWeaponLoadout"]);
    expect(WO6_BLOCK).not.toMatch(/^enum /m);
    expect(SCHEMA.match(/\/\/ M6-WO6 back-relation/g)).toHaveLength(3);
  });

  it("removing exactly the marked WO6 additions restores the M6-WO5 schema; earlier migrations are untouched", () => {
    expect(BASELINE.baseCommit).toBe("3cedeab83bb3890bc5b7cc4855b37e9e946094d9");
    const without = SCHEMA.replace(/^[^\n]*\/\/ M6\-WO6 back-relation[^\n]*\n/gm, "").replace(/\n\/\/ >>> M6\-WO6[^\n]*\n[\s\S]*?\/\/ <<< M6\-WO6[^\n]*\n/, "");
    expect(hash(without)).toBe(BASELINE.frozenFiles[SCHEMA_PATH]);
    for (const [f, h] of Object.entries(BASELINE.frozenFiles).filter(([k]) => k.endsWith("migration.sql"))) expect(hash(readFileSync(path.join(ROOT, f))), f).toBe(h);
  });

  it("M6-I025-style integrity: exact pairs, explicit grip, RESTRICT relations, no function, trigger, cascade or drop", () => {
    expect(MIGRATION).toMatch(/main_hand_pair_check" CHECK \(\("main_hand_entity_id" IS NULL\) = \("main_hand_entity_version_id" IS NULL\)\)/);
    expect(MIGRATION).toMatch(/off_hand_pair_check" CHECK \(\("off_hand_entity_id" IS NULL\) = \("off_hand_entity_version_id" IS NULL\)\)/);
    expect(MIGRATION).toMatch(/"main_hand_grip" IN \('ONE_HANDED', 'TWO_HANDED'\)/);
    expect(MIGRATION).toMatch(/REFERENCES "entity_versions"\("id", "entity_id"\)/);
    expect(MIGRATION).not.toMatch(/CASCADE|SET NULL|CREATE (OR REPLACE )?FUNCTION|CREATE TRIGGER|DROP |ALTER TABLE "(characters|entity_versions|character_\w+_states?)" (ADD|ALTER|DROP) COLUMN/i);
    expect(MIGRATION.match(/ON DELETE RESTRICT ON UPDATE RESTRICT/g)).toHaveLength(3);
  });

  it("§7 no inventory, ammunition, Armor or encounter model exists", () => {
    expect(SCHEMA).not.toMatch(/model (?!MigrationPlanItem\b)\w*(Inventory|Item|Ammo|Ammunition|Armou?r|Magazine|Reload|Gear|Encounter)\w* \{/);
  });
});

describe("M6-WO6 gate — API and Studio presentation (§86–§92, §99–§139)", () => {
  it("the five WO6 routes are registered exactly and are thin adapters with central error mapping", () => {
    const registry = JSON.parse(read("docs/architecture/m6-api-routes.json")) as Record<string, unknown>;
    expect([...(registry["M6-WO6"] as string[])].sort()).toEqual([...ROUTES].sort());
    for (const f of ROUTES) {
      const src = read(f);
      expect(src, f).toMatch(/return toErrorResponse\(error\);/);
      expect(src, f).toMatch(/from "@prowess\/db";/);
      expect(src, f).not.toMatch(/@prowess\/(game|rules)|prisma|evaluate\w*\(|calculate/i);
    }
    expect(read(ROUTES[1]!)).toMatch(/readStrictBody\(request, \["expectedVersion", "mainHand", "mainHandGrip", "offHand"\]\)/);
  });

  it("Studio never calculates Power, multipliers, dice or AP; it formats the server's preview only", () => {
    for (const f of WEAPON_UI) {
      const src = strip(read(f));
      expect(src, f).not.toMatch(/Math\.|floor\(|\.power\s*[*/+-]|[*/]\s*\w*\.?power\b|multiplier\s*[*/+-]|\.count\s*\*|apCost\s*[+*-]|Math\.max\(/);
      expect(src, f).not.toMatch(/from "(@prowess\/(db|game|rules)|@prisma\/client)[^"]*"/);
    }
    for (const f of CHARACTER_UI) expect(read(f), f).not.toMatch(/from "(@prowess\/(db|game|rules)|@prisma\/client)[^"]*"/);
  });

  it("the Character Sheet and libraries use no hard-coded Weapon catalog", { timeout: 60_000 }, () => {
    const names = WEAPONS.map((w) => w.displayName);
    for (const f of [...code("apps/studio/app"), ...code("apps/studio/src"), ...code("packages/prowess-db/src")]) {
      const src = read(f);
      const hits = names.filter((n) => new RegExp(`["'\`]${n.replace(/[()]/g, "\\$&")}["'\`]`).test(src));
      expect(hits, f).toEqual([]);
    }
  });

  it("the admin editors take every option from the catalog and every reference from the exact picker", () => {
    const editors = strip(read("apps/studio/app/compendium/admin/_components/WeaponEditors.tsx"));
    expect(editors).not.toMatch(/"[A-Z][A-Z_]{2,}"/);
    expect(editors).toMatch(/definitionKind=\{refKind\}/);
    const desc = read("apps/studio/app/compendium/admin/_lib/descriptors.ts");
    expect(desc).toMatch(/const ATTACK_KIND = "ATTACK";\nconst EQUIPMENT_TRAIT_KIND = "EQUIPMENT_TRAIT";/);
  });
});

describe("M6-WO6 gate — approved M5 change, invariants, documentation and CI (§175–§187)", () => {
  it("the approved M5 change registry lists exactly the WO6 files at their current hashes; the M5 change is additive", () => {
    const approved = JSON.parse(read("docs/architecture/m6-approved-m5-changes.json")) as Record<string, { changedFiles: Record<string, string>; addedFiles: Record<string, string> } | string>;
    const wo6 = approved["M6-WO6"] as { changedFiles: Record<string, string>; addedFiles: Record<string, string> };
    expect(Object.keys(wo6.changedFiles).sort()).toEqual(
      ["character/advancement.ts", "character/sheet.ts", "compilation/compile.ts", "definition/authored-ability-payload.ts", "definition/payload.ts", "index.ts", "m6-wo3-registry.test.ts", "m6-wo4-registry.test.ts", "stored-definition-validation.test.ts", "vocabulary/families.ts"].map((f) => `${GAME_DIR}/${f}`),
    );
    expect(Object.keys(wo6.addedFiles).every((f) => f.startsWith(`${GAME_DIR}/`))).toBe(true);
    for (const f of [...WO6_GAME, CONTENT_PATH, `${GAME_DIR}/testing/weapon-fixtures.ts`]) expect(Object.keys(wo6.addedFiles), f).toContain(f);
    for (const [f, h] of [...Object.entries(wo6.changedFiles), ...Object.entries(wo6.addedFiles)]) expect(hash(readFileSync(path.join(ROOT, f))), f).toBe(h);
    const m5 = strip(read(`${GAME_DIR}/definition/authored-ability-payload.ts`));
    expect(m5).toMatch(/\| \{ readonly kind: "WEAPON"; readonly weaponKey: string; readonly baseDice: string; readonly power: number; readonly stat: ProwessStat; readonly enchantments: readonly string\[\] \}/);
    expect(m5).toMatch(/\| \{ readonly kind: "WEAPON"; readonly scaling: "STATIC"; readonly weaponKey: string; readonly baseDice: string; readonly power: null; readonly stat: null; readonly enchantments: readonly string\[\] \};/);
  });

  it("M4 source is untouched (frozen hashes since M6-WO2)", () => {
    const wo2 = JSON.parse(read("docs/architecture/m6-wo2-baseline.json")) as { frozenFiles: Record<string, string> };
    const m4 = Object.entries(wo2.frozenFiles).filter(([f]) => f.startsWith("packages/prowess-rules/src/"));
    expect(m4.length).toBeGreaterThan(20);
    for (const [f, h] of m4) expect(hash(readFileSync(path.join(ROOT, f))), f).toBe(h);
  });

  const inv = JSON.parse(read("docs/architecture/m6-invariants.json")) as Array<{ id: string; title: string; guards: string[] }>;
  it("M6-I057–I076 follow M6-I001–I056, are documented, and each is guarded by executing files that cite it", () => {
    expect(inv.map((x) => x.id)).toEqual(Array.from({ length: 76 }, (_, i) => `M6-I${String(i + 1).padStart(3, "0")}`));
    const md = read("docs/architecture/m6-invariants.md");
    for (const row of inv.slice(56, 76)) {
      expect(md).toContain(`### ${row.id} — ${row.title}`);
      expect(row.guards).toContain("apps/studio/tests/unit/m6-wo6-static.test.ts");
      expect(row.guards).toContain("scripts/m6-wo6-negative-controls.mjs");
      for (const g of row.guards) {
        expect(existsSync(path.join(ROOT, g)), g).toBe(true);
        if (/\.test\.tsx?$/.test(g)) expect(read(g), `${row.id} → ${g}`).toContain(row.id);
      }
    }
  });

  it("the architecture document and the implementation report exist with their required sections", () => {
    const doc = read("docs/architecture/m6-weapon-attack-library.md");
    for (const h of ["Definition Kinds", "Damage", "Properties", "Loadout", "Shields", "Dual Wield", "Unarmed", "Character Attack Library", "Maneuver Bridge", "API", "Known Limitations"]) expect(doc, h).toMatch(new RegExp(`^## \\d+\\. ${h}$`, "m"));
    const report = read("docs/reports/m6-wo6-implementation-report.md");
    for (const h of ["Test Totals", "Architecture Gate", "Controls"]) expect(report, h).toMatch(new RegExp(`^## \\d+\\. ${h}`, "m"));
  });

  it("the M6-WO6 gate is a named step of the consolidated CI workflow with its exact control count; no m6-wo6.yml", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toMatch(/- name: M6-WO6 — Weapon & Attack Library\n\s+run: \|\n[\s\S]*?node scripts\/ci\/verify-gate\.mjs M6-WO6 [^\n]*\n\s+PROWESS_EXPECT_CONTROLS=\d+ node scripts\/m6-wo6-negative-controls\.mjs/);
    expect(existsSync(path.join(ROOT, ".github/workflows/m6-wo6.yml"))).toBe(false);
    const gates = JSON.parse(read("scripts/ci/gates.json")) as { gates: Array<{ id: string; tests: string[]; controls: { script: string; count: number } | null }> };
    const gate = gates.gates.find((g) => g.id === "M6-WO6");
    expect(gate?.controls?.script).toBe("scripts/m6-wo6-negative-controls.mjs");
    expect(gate?.controls?.count).toBeGreaterThanOrEqual(48);
    const count = Number(/PROWESS_EXPECT_CONTROLS=(\d+) node scripts\/m6-wo6-negative-controls\.mjs/.exec(ci)?.[1]);
    expect(count).toBe(gate?.controls?.count);
    for (const t of gate?.tests ?? []) expect(existsSync(path.join(ROOT, t)), t).toBe(true);
  });
});
