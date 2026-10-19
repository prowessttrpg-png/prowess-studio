// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Permanent M5-WO5 static gate — Shared Modular Ability Construction Framework. */
const ROOT = path.resolve(process.cwd(), "..", "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const walk = (dir: string): string[] =>
  existsSync(path.join(ROOT, dir))
    ? readdirSync(path.join(ROOT, dir))
        .filter((n) => !["node_modules", "dist", ".next", "generated"].includes(n))
        .flatMap((n) => {
          const f = `${dir}/${n}`;
          return statSync(path.join(ROOT, f)).isDirectory() ? walk(f) : [f];
        })
    : [];
const hash = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

const compiler = () => read("packages/prowess-game/src/construction/legality.ts");
const constructionContent = () => JSON.parse(read("packages/prowess-game/src/content/core-playtest-v0.1/ability-construction.json")) as {
  definitions: Array<{ canonicalKey: string; definitionKind: string; payload: Record<string, unknown> }>;
};

describe("M5-WO5 audit — Shared modular Ability Construction", () => {
  it("keeps @prowess/rules byte-identical to the frozen M4 baseline", () => {
    const baseline = JSON.parse(read("docs/architecture/m5-wo2-baseline.json")) as { rulesSrcTreeHash: string; rulesSrcFileCount: number };
    const files = walk("packages/prowess-rules/src").sort();
    const tree = createHash("sha256");
    for (const file of files) tree.update(`${file}\n${hash(readFileSync(path.join(ROOT, file)))}\n`);
    expect(files.length).toBe(baseline.rulesSrcFileCount);
    expect(tree.digest("hex")).toBe(baseline.rulesSrcTreeHash);
  });

  it("stores all numeric Ability Construction capacities in exact versioned content, not vocabulary/compiler switches", () => {
    const content = constructionContent();
    expect(content.definitions).toHaveLength(1);
    const rule = content.definitions[0]!;
    expect(rule.canonicalKey).toBe("ability.construction_rule");
    expect(rule.definitionKind).toBe("ABILITY_CONSTRUCTION_RULE");
    const ranks = rule.payload.ranks as Array<Record<string, unknown>>;
    expect(ranks.map((r) => r.rank)).toEqual(["UNTRAINED", "TRAINED", "EXPERT", "MASTER"]);
    expect(read("packages/prowess-game/src/vocabulary/ability-construction.ts")).not.toMatch(/effectCapacity:\s*[0-9]|traitCapacity:\s*[0-9]|maximumTraitTrades:\s*[0-9]/);
    expect(compiler()).not.toMatch(/switch\s*\(.*(?:rank|authority)/i);
  });

  it("uses the existing Arcana and Martial Skill ranks and creates no new progression track", () => {
    const vocab = read("packages/prowess-game/src/vocabulary/ability-construction.ts");
    expect(vocab).toContain('ARCANA_SKILL_KEY = "skill.arcana"');
    expect(vocab).toContain('MARTIAL_SKILL_KEY = "skill.martial"');
    expect(vocab).not.toMatch(/ArcaneProgression|MartialProgression|ARCANE_RANK_TRACK|MARTIAL_RANK_TRACK/);
    const terminology = read("packages/prowess-game/src/vocabulary/terminology.ts");
    expect(terminology).toContain('entry("Arcane Rank", "SKILL_RANK", C, "SKILL", "ARCANE_RANK"');
  });

  it("M5-I156 pins the two valid Spell access paths and requires one explicit selected Authority", () => {
    const src = compiler();
    expect(src).toContain('authority === "ARCANE_AUTHORITY"');
    expect(src).toContain('"AFFINITY_AUTHORITY"');
    expect(src).toContain('spell-arcane-authority-access');
    expect(src).toContain('spell-affinity-authority-access');
    expect(src).toContain("GOVERNING_AFFINITY_REQUIRED");
    expect(src).not.toMatch(/highest[-_ ]rank.*authority|auto.*authority/i);
  });

  it("M5-I157 derives Casting Condition capacity only from Arcana Skill rank regardless of Authority", () => {
    const src = compiler();
    expect(src).toContain("const arcaneRank = skillRank(character, ARCANA_SKILL_KEY)");
    expect(src).toContain("castingConditionCapacity = constructionRank(constructionRule, arcaneRank).arcane.castingConditionCapacity");
    expect(src).toContain('"casting-condition-capacity-from-arcane-rank"');
    expect(src).not.toMatch(/affinityRank.*castingCondition|affinity.*conditionCapacity/i);
  });

  it("pins Spell-only 1:1 Effect→Trait exchange with at least one retained Effect and no Arcane+Affinity capacity addition", () => {
    const src = compiler();
    expect(src).toContain('"capacity.effective_effects", "base - trades"');
    expect(src).toContain('"capacity.effective_traits", "base + trades"');
    expect(src).toContain('"capacity.minimum_effect"');
    expect(src).toContain("constructionRule.payload.spellAccess.minimumEffects");
    expect(src).toContain('"spell-only-trait-exchange-limit"');
    expect(src).not.toMatch(/arcane.*effectCapacity\s*\+\s*.*affinity|affinity.*effectCapacity\s*\+\s*.*arcane/i);
  });

  it("requires explicit Effect stacking permission and an explicit stack-limit rule; Rank Value is never a global fallback", () => {
    const src = compiler();
    expect(src).toContain('own(rules, "stacking")');
    expect(src).toContain("a stackable Effect explicitly authors its stack-limit rule");
    expect(src).toContain('kind === "FIXED"');
    expect(src).toContain('kind === "SKILL_RANK_VALUE"');
    expect(src).toContain('kind === "GOVERNING_AFFINITY_RANK_VALUE"');
    expect(src).toContain("no default is inferred");
  });

  it("pins one Signature slot per ordinary candidate, PRO capacity and explicit-only exemptions", () => {
    const content = constructionContent().definitions[0]!.payload as { signature: { defaultSlotsPerAbility: number; capacityStat: string } };
    expect(content.signature).toEqual({ defaultSlotsPerAbility: 1, capacityStat: "PRO" });
    const src = compiler();
    expect(src).toContain("signature.exemption === null ? constructionRule.payload.signature.defaultSlotsPerAbility : 0");
    expect(src).toContain('"signature.projected", "used + candidate"');
    expect(src).toContain('"signature-ability-capacity"');
  });

  it("compiles legality through M4 Formula/Keyword/Requirement only and contains no cost/runtime resolution engine", () => {
    const src = compiler();
    const operations = [...src.matchAll(/operation:\s*"([A-Z_]+)"/g)].map((m) => m[1]);
    expect([...new Set(operations)].sort()).toEqual(["FORMULA", "KEYWORD", "REQUIREMENT"]);
    expect(src).not.toMatch(/operation:\s*"(?:MODIFIER|RESOURCE|VALIDATION|EXPLANATION)"/);
    expect(src).not.toMatch(/Math\.(?:floor|ceil|round|random)|Date\.now|new Date\(|fetch\(|prisma\.|DATABASE_URL/);
  });

  it("has no Prisma schema/migration or API route change", () => {
    const wo1 = JSON.parse(read("docs/architecture/m5-wo1-baseline.json")) as { schemaHash: string; migrations: Record<string, string> };
    expect(hash(read("packages/prowess-db/prisma/schema.prisma"))).toBe(wo1.schemaHash);
    expect(Object.fromEntries(walk("packages/prowess-db/prisma/migrations").filter((f) => f.endsWith("migration.sql")).map((f) => [f, hash(read(f))]))).toEqual(wo1.migrations);
    const wo4 = JSON.parse(read("docs/architecture/m5-wo4-baseline.json")) as { apiRoutes: string[] };
    expect(walk("apps/studio/app/api").filter((f) => f.endsWith("route.ts")).sort()).toEqual(wo4.apiRoutes);
  });

  it("represents M5-I001–I157 with the WO5 append-only invariant extension and every WO5 guard exists", () => {
    const prior = JSON.parse(read("docs/architecture/m5-invariants.json")) as Array<{ id: string; guards: string[] }>;
    const wo5 = JSON.parse(read("docs/architecture/m5-wo5-invariants.json")) as Array<{ id: string; guards: string[] }>;
    const all = [...prior, ...wo5];
    expect(all.map((x) => x.id)).toEqual(Array.from({ length: 157 }, (_, i) => `M5-I${String(i + 1).padStart(3, "0")}`));
    expect(wo5.map((x) => x.id)).toEqual(["M5-I156", "M5-I157"]);
    for (const invariant of wo5) {
      expect(invariant.guards).toContain("apps/studio/tests/unit/m5-wo5-static.test.ts");
      for (const guard of invariant.guards) expect(existsSync(path.join(ROOT, guard)), `${invariant.id} → ${guard}`).toBe(true);
    }
  });

  it("documents the frozen scope boundary: legality now; costs/catalog execution/resolution later", () => {
    const doc = read("docs/architecture/m5-shared-ability-construction.md");
    for (const phrase of ["can this exact character legally construct", "does **not** calculate Spell or Maneuver costs", "Casting Condition capacity comes only", "Effect stacks only", "Signature Ability capacity equals PRO"]) expect(doc).toContain(phrase);
  });
});
