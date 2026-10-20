import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../../../..");
const text = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");
const json = <T>(path: string): T => JSON.parse(text(path)) as T;

interface InvariantEntry {
  readonly id: string;
  readonly title: string;
  readonly status?: string;
  readonly supersededBy?: string;
  readonly guards: readonly string[];
}

describe("M5-WO7 audit — Effect framework & Spell/Maneuver contracts", () => {
  const vocabulary = text("packages/prowess-game/src/vocabulary/effect.ts");
  const payload = text("packages/prowess-game/src/definition/effect-payload.ts");
  const compiler = text("packages/prowess-game/src/effect/compile.ts");
  const effects = text("packages/prowess-game/src/content/core-playtest-v0.1/effects.ts");
  const targeting = text("packages/prowess-game/src/content/core-playtest-v0.1/targeting-wo7-amendments.ts");
  const historicalTargeting = text("packages/prowess-game/src/content/core-playtest-v0.1/targeting.json");
  const docs = text("docs/architecture/m5-effect-framework.md");
  const rulesPackage = text("packages/prowess-rules/package.json");
  const familyBlock = vocabulary.match(/SPELL_EFFECT_FAMILIES\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\s+as const\)/)?.[1] ?? "";

  it("keeps Prowess Effect semantics out of the generic M4 package and DB access out of @prowess/game", () => {
    expect(rulesPackage).not.toMatch(/prowess-game|SPELL_EFFECT|MANEUVER_EFFECT|Projectile|Effect Framework/);
    expect(`${payload}\n${compiler}`).not.toMatch(/@prisma|PrismaClient|from\s+["']@prowess\/db|DATABASE_URL/);
  });

  it("preserves branch separation and exactly seven canonical Spell Effect families", () => {
    expect(familyBlock.match(/"[A-Z_]+"/g)).toEqual(["\"DAMAGE\"", "\"HEALING\"", "\"BUFF\"", "\"DEBUFF\"", "\"CONTROL\"", "\"UTILITY\"", "\"SUMMONING\""]);
    expect(familyBlock).not.toMatch(/MOVEMENT|CLEANSE|SPELL_INTERFERENCE/);
    expect(payload).toContain('branch === "SPELL"');
    expect(payload).toContain('branch === "MANEUVER"');
  });

  it("locks Projectile to 3 MP, caster Range and Ranged Attack delivery while Effect Save remains separate", () => {
    expect(targeting).toContain('amount: 3');
    expect(targeting).toContain('model: "DEFAULT_SPELL_RANGE"');
    expect(targeting).toContain('check: "RANGED_ATTACK_ROLL"');
    expect(compiler).toContain('"SAME_ATTACK_ROLL"');
    expect(compiler).toContain('"DELIVERY_THEN_SAVE"');
    expect(payload).toContain('saveProfile');
    expect(targeting).not.toMatch(/validSaves|saveProfile/);
    expect(`${targeting}\n${compiler}`).not.toMatch(/projectileDoubleAttack|skipProjectileDelivery/);
  });

  it("locks Spell Line to 10×PRO and 5×ceil(PRO/2), with no deferred current-canon width", () => {
    expect(targeting).toContain('expression: "10 * pro + length_extension * 10"');
    expect(targeting).toContain('expression: "5 * ceil(pro / 2) + width_extension * 5"');
    expect(targeting).not.toContain('15 * pro');
    expect(targeting).not.toContain('DEFERRED_PENDING_CANON');
    expect(targeting).not.toContain('floor(pro / 2)');
  });

  it("uses exact compatibility, explicit Spell resolution and explicit Maneuver inheritance", () => {
    expect(payload).toContain('SPELL_EFFECT_RESOLUTION_REQUIRED');
    expect(payload).toContain('INHERIT_ABILITY');
    expect(compiler).toContain('relation === "TARGETING"');
    expect(`${payload}\n${compiler}`).not.toMatch(/includes\([^)]*display|toLowerCase\(\).*targeting|fuzzy|implicitManeuverInheritance/);
    const direct = effects.slice(effects.indexOf('spell.effect.direct_damage'), effects.indexOf('spell.effect.direct_healing'));
    expect(direct).toContain('{ mode: "ATTACK_ROLL", data: {} }');
  });

  it("keeps Character Dice limits per Effect and forbids global or implicit secondary mechanics", () => {
    expect(effects).toContain('maximum: { kind: "STAT", stat: "PRO" }');
    expect(effects).toContain('DAMAGE_TYPE_ONLY_NO_IMPLICIT_CONDITION');
    expect(`${effects}\n${compiler}`).not.toMatch(/globalCharacterDiceCap|damageImpliesBurning/);
    const conversion = effects.slice(effects.indexOf('maneuver.effect.elemental_damage_conversion'));
    expect(conversion).not.toMatch(/Burning|Shocked|Poisoned|Mana Drain/);
  });

  it("keeps conversion cost/save data on Maneuver Effects rather than Maneuver Targeting", () => {
    expect(effects).toContain('maneuver.effect.radius_attack_conversion');
    expect(effects).toContain('validSaves: ["AGI", "PRO"]');
    expect(effects).toContain('fixed(`${canonicalKey}.ap`, "AP", ap)');
    expect(historicalTargeting).not.toMatch(/Save Profile|saveProfile|conversionCostDuplicate/);
  });

  it("does not calculate final Ability cost or execute runtime Effects / chains / ME feedback", () => {
    expect(`${payload}\n${compiler}`).not.toMatch(/finalSpellCost|finalManeuverCost|applyDamage|restoreHp|mutateHp|executeEffectChain|spendManaEfficiency|runtimeHpMutation/);
    expect(docs).toContain("final Spell cost — WO10");
    expect(docs).toContain("final Maneuver cost — WO11");
    expect(docs).toContain("Effect Chain execution — WO12");
  });

  it("pins exact Ruleset/version provenance and represents all M5-I001–I212 invariants", () => {
    expect(compiler).toContain("entityVersionId");
    expect(compiler).toContain("rulesetProvenance");
    expect(compiler).not.toMatch(/latestEffect|currentEffect|newestEffectVersion/);
    const invariants = json<InvariantEntry[]>("docs/architecture/m5-invariants.json");
    const ids = new Set(invariants.map((entry) => entry.id));
    for (let i = 1; i <= 212; i += 1) expect(ids.has(`M5-I${String(i).padStart(3, "0")}`), `M5-I${String(i).padStart(3, "0")}`).toBe(true);
    expect(invariants.find((entry) => entry.id === "M5-I160")?.status).toBe("SUPERSEDED");
    expect(invariants.find((entry) => entry.id === "M5-I163")?.status).toBe("SUPERSEDED");
    expect(invariants.find((entry) => entry.id === "M5-I167")?.status).toBe("SUPERSEDED");
  });
});
