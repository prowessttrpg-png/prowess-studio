// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withLaterMilestoneRoutes } from "./later-milestone-routes";
import { auditWo3Content, auditWo3Source, type Wo3Layer } from "./m5-wo3-audit-helpers";

/**
 * M5-WO3 audit — Runtime resources, action economy & movement (PAS-10 M5-WO3 §195, §215).
 *
 * Permanent static gate over @prowess/game (pure Prowess domain), the frozen @prowess/rules engine and the canonical
 * core + runtime content documents, plus the conflict register, terminology, invariant catalog, documentation and CI
 * contracts. In-memory controls append forbidden code to REAL source snapshots (or mutate a copy of the content) and
 * require the matching rule to fire. Behavioural controls that mutate files on disk live in
 * scripts/m5-wo3-negative-controls.mjs.
 *
 * Invariants guarded here (docs/architecture/m5-invariants.md): M5-I075 Base Movement 5 × AGI · M5-I076 Size movement
 * explicit only · M5-I077 non-stacking signals · M5-I078 presence cancellation · M5-I079 signal provenance · M5-I080
 * distinct Resources · M5-I081 maximum vs current · M5-I082 HP no refresh · M5-I083 MP no refresh · M5-I084 AP refresh ·
 * M5-I085 AP expiry · M5-I086 Counter capacity / refresh · M5-I087 no Counter banking · M5-I088 Counter vs AP · M5-I089
 * ME = PRO, refresh · M5-I090 ME before MP when eligible · M5-I091 listed cost unchanged · M5-I092 atomic payment ·
 * M5-I093 reservation · M5-I094 release · M5-I095 M4 Resource operations · M5-I096 AP is points · M5-I097 action costs
 * are content · M5-I098 Move allowance · M5-I099 split movement · M5-I100 Difficult Terrain · M5-I101 side Initiative ·
 * M5-I102 Initiative formula · M5-I103 tie-break · M5-I104 Surprise · M5-I105 no persistence · M5-I106 provenance ·
 * M5-I107 zero HP · M5-I108 occupied space ≠ speed · M5-I109 repeated Sprint · M5-I110 atomic ordinary costs.
 * Historical: M5-I073 is SUPERSEDED by M5-I075 (traceable, not deleted). Post-WO4 rulings: M5-I152 → M5-I154 (Size Base
 * Movement Small 5 · Medium 5 · Large 10 · Huge 20 · Massive 40 ft).
 */
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
const production = (dir: string) => walk(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.includes("/testing/"));
const hash = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

const GAME = production("packages/prowess-game/src");
const WO3_LATER_MILESTONE_EFFECT_FILES = new Set([
  "packages/prowess-game/src/content/core-playtest-v0.1/effects.ts",
  "packages/prowess-game/src/definition/effect-payload.ts",
  "packages/prowess-game/src/effect/compile.ts",
]);
const WO3_GAME = GAME.filter((f) => !WO3_LATER_MILESTONE_EFFECT_FILES.has(f));
const RULES = production("packages/prowess-rules/src");
const CORE_FILE = "packages/prowess-game/src/content/core-playtest-v0.1/core-resolution.json";
const RUNTIME_FILE = "packages/prowess-game/src/content/core-playtest-v0.1/runtime-resources.json";
type Doc = { definitions: Array<{ canonicalKey: string; definitionKind: string; payload: Record<string, unknown> }>; deferred?: unknown[]; designerRulings?: string[] };
const core = () => JSON.parse(read(CORE_FILE)) as Doc;
const runtime = () => JSON.parse(read(RUNTIME_FILE)) as Doc;
const inventory: Array<[string, Wo3Layer]> = [...WO3_GAME.map((f) => [f, "game"] as [string, Wo3Layer]), ...RULES.map((f) => [f, "rules"] as [string, Wo3Layer])];
const section = (doc: string, key: string) => doc.split(/^### /m).find((s) => s.startsWith(key)) ?? "";

describe("M5-WO3 audit — Runtime resources, action economy & movement", () => {
  it("covers @prowess/game (with the WO3 runtime modules), @prowess/rules and both canonical content documents", () => {
    for (const f of ["runtime/compile.ts", "runtime/definitions.ts", "runtime/resources.ts", "runtime/results.ts", "runtime/combat.ts", "definition/runtime-payload.ts", "vocabulary/runtime.ts", "internal/order.ts"]) {
      expect(GAME).toContain(`packages/prowess-game/src/${f}`);
    }
    expect(RULES.length).toBeGreaterThan(20);
    expect([core().definitions.length, runtime().definitions.length]).toEqual([33, 26]);
  });

  it.each(inventory)("%s passes the WO3 %s rules (no persistence, name switches, netting, stacking, Size speed, player ordering, randomness)", (file, layer) => {
    expect(auditWo3Source(read(file), file, layer)).toEqual([]);
  });

  it("canonical core + runtime content passes every WO3 rule (M5-I075 · M5-I076 · M5-I080–I090 · M5-I093 · M5-I097 · M5-I098 · M5-I100 · M5-I102–I104 · M5-I108 · M5-I109)", () => {
    expect(auditWo3Content(core(), runtime())).toEqual([]);
  });

  it("M5-I095 the generic M4 engine is byte-identical to the WO2 baseline; WO3 adds no Prowess resource arithmetic to it", () => {
    const wo2 = JSON.parse(read("docs/architecture/m5-wo2-baseline.json")) as { rulesSrcTreeHash: string; rulesSrcFileCount: number; apiRoutes: string[] };
    const wo3 = JSON.parse(read("docs/architecture/m5-wo3-baseline.json")) as { rulesSrcTreeHash: string; rulesSrcFileCount: number; apiRoutes: string[]; baseCommit: string };
    const files = walk("packages/prowess-rules/src").sort();
    const tree = createHash("sha256");
    for (const f of files) tree.update(`${f}\n${hash(readFileSync(path.join(ROOT, f)))}\n`);
    const digest = tree.digest("hex");
    expect([files.length, digest]).toEqual([wo2.rulesSrcFileCount, wo2.rulesSrcTreeHash]);
    expect([wo3.rulesSrcFileCount, wo3.rulesSrcTreeHash]).toEqual([wo2.rulesSrcFileCount, wo2.rulesSrcTreeHash]);
    expect(wo3.baseCommit).toMatch(/^[0-9a-f]{40}$/);
    // Every runtime operation the compiler emits is an M4 Resource / Formula / Requirement operation.
    const compile = read("packages/prowess-game/src/runtime/compile.ts");
    for (const op of ["RESOURCE_PAYMENT_PREVIEW", "RESOURCE_PAYMENT_APPLY", "REQUIREMENT", "FORMULA"]) expect(compile).toContain(`"${op}"`);
    expect(compile).toMatch(/operation: `RESOURCE_\$\{operation\}`/);
    // The only arithmetic in the runtime compiler is plan layout, in internal/order.ts — never a game value.
    expect(read("packages/prowess-game/src/internal/order.ts")).toMatch(/never a game value/);
  });

  it("M5-I105 no schema change, no migration, no new endpoint, no persistence path and no UI dependency", () => {
    const wo1 = JSON.parse(read("docs/architecture/m5-wo1-baseline.json")) as { schemaHash: string; migrations: Record<string, string> };
    expect(hash(read("packages/prowess-db/prisma/schema.prisma"))).toBe(wo1.schemaHash);
    expect(Object.fromEntries(walk("packages/prowess-db/prisma/migrations").filter((f) => f.endsWith("migration.sql")).map((f) => [f, hash(read(f))]))).toEqual(wo1.migrations);
    const wo3 = JSON.parse(read("docs/architecture/m5-wo3-baseline.json")) as { apiRoutes: string[] };
    expect(walk("apps/studio/app/api").filter((f) => f.endsWith("route.ts")).sort()).toEqual(withLaterMilestoneRoutes(wo3.apiRoutes));
    expect(walk("apps/studio/app/api").join("\n")).not.toMatch(/commit-turn|spend|apply-to-character|evaluate-and-save|encounter/i);
    expect(Object.keys((JSON.parse(read("apps/studio/package.json")) as { dependencies: Record<string, string> }).dependencies)).not.toContain("@prowess/game");
    expect(Object.keys((JSON.parse(read("packages/prowess-game/package.json")) as { dependencies: Record<string, string> }).dependencies).sort()).toEqual(["@prowess/model", "@prowess/rules"]);
    expect(read("packages/prowess-db/prisma/schema.prisma")).not.toMatch(/model\s+Encounter|currentHp|currentAp/i);
  });

  it("M5-I097 RESOURCE and ACTION are active v1 structured payloads; no action-name cost table exists in code", () => {
    const families = read("packages/prowess-game/src/vocabulary/families.ts");
    expect(families).toMatch(/RESOURCE: active\("RESOURCE", \["RESOURCE"\]\)/);
    expect(families).toMatch(/ACTION: active\("ACTION_ECONOMY"\)/);
    expect(families).toMatch(/CREATURE_SIZE: active\("CHARACTER"\)/);
    expect(read("packages/prowess-game/src/definition/runtime-payload.ts")).toMatch(/export function readRuntimePayload/);
    for (const file of GAME) expect(read(file), file).not.toMatch(/\bMOVE:\s*1\b|\bHEAVY_ATTACK:\s*3\b/);
  });

  it("M5-I077–I079 roll signals: three modes only; presence resolution keeps every source; the WO2 fail-closed code is gone", () => {
    expect(read("packages/prowess-game/src/vocabulary/core.ts")).toMatch(/export const ROLL_MODES = deepFreeze\(\["NORMAL", "ADVANTAGE", "DISADVANTAGE"\] as const\);/);
    const dice = read("packages/prowess-game/src/core/dice.ts");
    expect(dice).toMatch(/hasAdvantage === hasDisadvantage \? "NORMAL"/);
    expect(dice).toMatch(/advantage, disadvantage, cancelled: hasAdvantage && hasDisadvantage, ruling: ROLL_SIGNAL_RULING/);
    for (const file of GAME) expect(read(file), file).not.toMatch(/ROLL_MODE_CONFLICT/);
  });

  it("M5-I076 / M5-I108 / M5-I075 terminology: Base Movement canonical by designer ruling; Dodge Action ≠ Dodge; Size identity", () => {
    const t = read("packages/prowess-game/src/vocabulary/terminology.ts");
    // Post-WO3 amendment (M5-WO4): Base Movement is the authored creature value; Movement = Base Movement × AGI.
    expect(t).toContain('entry("Base Movement", "DERIVED_STAT", C, "CHARACTER", "BASE_MOVEMENT", { ...designer, conflictKey: "M5-SC-033" })');
    expect(t).toContain('entry("Movement", "DERIVED_STAT", C, "CHARACTER", "MOVEMENT", { ...designer, conflictKey: "M5-SC-006" })');
    for (const term of ["Movement Allowance", "Creature Size", "Action Points", "Counter Action", "Mana Efficiency", "Mana Points", "Dodge Action"]) expect(t, term).toContain(`entry("${term}"`);
    expect(t).toMatch(/entry\("Dodge Action", "ACTION", C, "ACTION_ECONOMY", "DODGE_ACTION"\)/);
    expect(t).toMatch(/entry\("Dodge", "DERIVED_STAT", C, "CHARACTER", "DODGE"/);
  });

  it("source-conflict register: M5-SC-006 and M5-SC-032 RESOLVED_BY_DESIGNER (history kept); M5-SC-033 recorded (resolved post-WO4, M5-I152); M5-SC-034 recorded (resolved post-WO3)", () => {
    const register = read("docs/architecture/m5-core-playtest-source-conflicts.md");
    for (const key of ["M5-SC-006", "M5-SC-032"]) {
      const s = section(register, key);
      expect(s, key).toMatch(/\*\*status\*\*: `RESOLVED_BY_DESIGNER`/);
      expect(s, key).toMatch(/\*\*resolution authority\*\*: M5-WO3 §/);
      expect(s, key).toMatch(/\*\*source A\*\*:[\s\S]*\*\*source B\*\*:/);
    }
    expect(section(register, "M5-SC-006")).toMatch(/5 × AGI[\s\S]*10 × AGI[\s\S]*DEFERRED_PENDING_CANON/);
    expect(section(register, "M5-SC-032")).toMatch(/ROLL_MODE_CONFLICT[\s\S]*NORMAL/);
    // The post-WO4 designer ruling resolved M5-SC-033 (WO3 history kept in the entry); Massive is M5-SC-036.
    expect(section(register, "M5-SC-033")).toMatch(/\*\*status\*\*: `RESOLVED_BY_DESIGNER`/);
    expect(section(register, "M5-SC-033")).toMatch(/WO3 and WO4 status was `UNRESOLVED`/);
    expect(section(register, "M5-SC-033")).toMatch(/occupied space/i);
    // M5-WO4 applied the post-WO3 designer ruling: M5-SC-034 is RESOLVED_BY_DESIGNER (WO3 history kept in the entry).
    expect(section(register, "M5-SC-034")).toMatch(/\*\*status\*\*: `RESOLVED_BY_DESIGNER`/);
    expect(section(register, "M5-SC-034")).toMatch(/WO3 status above was `UNRESOLVED`/);
    expect(section(register, "M5-SC-034")).toMatch(/s71[\s\S]*s438/);
    expect(runtime().deferred).toEqual([]); // M5-SC-036 resolved in the rulings batch (M5-I154)
    expect(core().deferred).toEqual([]);
  });

  it("the M5 invariant catalog defines M5-I075–I110 with guards; M5-I073 is SUPERSEDED by M5-I075, not deleted (M5-WO4 later supersedes M5-I075 by M5-I111)", () => {
    const catalog = JSON.parse(read("docs/architecture/m5-invariants.json")) as Array<{ id: string; title: string; guards: string[]; status?: string; supersededBy?: string }>;
    expect(catalog.map((x) => x.id).slice(0, 110)).toEqual(Array.from({ length: 110 }, (_, i) => `M5-I${String(i + 1).padStart(3, "0")}`));
    for (const entry of catalog.slice(74, 110)) {
      expect(entry.guards, entry.id).toContain("apps/studio/tests/unit/m5-wo3-static.test.ts");
      expect(read("apps/studio/tests/unit/m5-wo3-static.test.ts"), entry.id).toContain(entry.id);
      expect(entry.status ?? "ACTIVE", entry.id).toBe(entry.id === "M5-I075" ? "SUPERSEDED" : "ACTIVE");
    }
    const superseded = catalog.find((x) => x.id === "M5-I073");
    expect([superseded?.status, superseded?.supersededBy]).toEqual(["SUPERSEDED", "M5-I075"]);
    expect(superseded?.title).toBe("Unresolved Movement Formula Conflict M5-SC-006 Must Not Produce Executable Canonical Movement Math");
    expect(catalog.filter((x) => x.status === "SUPERSEDED" && Number(x.id.slice("M5-I".length)) <= 155).map((x) => x.id)).toEqual(["M5-I073", "M5-I075", "M5-I119", "M5-I128", "M5-I152"]); // post-WO4: I119 → I151, I128 → I155, I152 → I154
    const md = read("docs/architecture/m5-invariants.md");
    expect(section(md, "M5-I073")).toMatch(/\*\*Status:\*\* SUPERSEDED by M5-I075/);
    expect(section(md, "M5-I075")).toContain("Base Movement Equals 5 Feet Times AGI");
  });

  it("documents WO3 with all 31 required sections and the §206–§211 diagrams", () => {
    const doc = read("docs/architecture/m5-runtime-resources-action-economy.md");
    const sections = [
      "Scope", "Source Authority", "M5-SC-006 Resolution", "M5-SC-032 Resolution", "M5-SC-033 Pending Size Movement Values", "Resource Model", "HP", "MP", "ME", "AP",
      "Counter Action", "Resource Refresh Timing", "Payment Ordering", "Reservation Boundary", "Action Definitions", "Common Action Costs", "Base Movement", "Creature Size", "Movement Allowance", "Split Movement",
      "Difficult Terrain", "Sprint", "Combat Round", "Initiative", "Shared Player Phase", "Surprise", "Roll-State Resolution", "M4 Compilation", "Provenance", "Runtime/Persistence Boundary",
      "Remaining Deferred Mechanics",
    ];
    sections.forEach((title, i) => expect(doc, title).toMatch(new RegExp(`^## ${i + 1}\\. ${title.replace(/[/.]/g, "\\$&")}$`, "m")));
    for (const diagram of ["new immutable runtime state", "START CREATURE TURN", "NO ARROW BACK TO LISTED COST", "values pending canon", "Counts never strengthen or net.", "Counter reactions from opposing side"]) {
      expect(doc, diagram).toContain(diagram);
    }
  });

  it("the M5-WO3 gate is a permanent named CI step; the M5-WO1 / M5-WO2 gates and every M0–M4 gate remain", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("M5-WO3 audit — Runtime resources, action economy & movement");
    for (const file of ["m5-wo3-static.test.ts", "runtime-resources-golden.test.ts", "runtime-contracts.test.ts", "prowess-runtime-resources-history.test.ts", "m5-wo3-inspector-fixture.test.ts", "m5-wo3-runtime-api.test.ts", "m5-wo3-negative-controls.mjs"]) expect(ci).toContain(file);
    expect(ci).toContain("M5-WO1 audit — Prowess domain & shared ability construction boundary");
    expect(ci).toContain("M5-WO2 audit — Core resolution, stats, dice & ranks");
    for (let i = 1; i <= 11; i += 1) expect(ci).toContain(`M4-WO${i} audit gate`);
    for (const gate of ["M1 audit gate", "M4-WO12 final audit", "Schema drift check", "pnpm run test:e2e"]) expect(ci).toContain(gate);
  });
});

// ---- In-memory controls (§174–§194): forbidden code / content must be caught by the matching rule ---------------------
const G = (f: string) => `packages/prowess-game/src/${f}`;
const sourceControls: Array<[string, string, string, Wo3Layer, string]> = [
  ["§175 10 × AGI movement program in code", G("runtime/compile.ts"), 'export const legacyMovement = { expression: "10 * agi" };', "game", "movement-not-canonical"],
  ["§176 movement modifier from Large occupied space", G("runtime/compile.ts"), "export const sizeMovement = { LARGE: 10, HUGE: 15 };", "game", "size-speed-inference"],
  ["§176 Size branch", G("runtime/compile.ts"), 'export const faster = (size: string) => size === "LARGE";', "game", "size-speed-inference"],
  ["§177 DOUBLE_ADVANTAGE mode", G("core/dice.ts"), 'export const STACKED = "DOUBLE_ADVANTAGE";', "game", "advantage-stacking"],
  ["§177 two Advantage sources strengthen the roll", G("core/dice.ts"), 'export const strong = (advantage: string[]) => (advantage.length >= 2 ? "GREATER" : "ADVANTAGE");', "game", "advantage-stacking"],
  ["§178 net Advantage count", G("core/dice.ts"), "export const net = (advantage: string[], disadvantage: string[]) => advantage.length - disadvantage.length;", "game", "net-advantage"],
  ["§178 count comparison", G("core/dice.ts"), 'export const wins = (advantage: string[], disadvantage: string[]) => (advantage.length > disadvantage.length ? "ADVANTAGE" : "NORMAL");', "game", "net-advantage"],
  ["§184 ME as a discount on the listed cost", G("runtime/compile.ts"), "export const effectiveCost = (listed: number, me: number) => listed;", "game", "me-discount"],
  ["§184 binding into the listed amount", G("runtime/compile.ts"), 'export const feedback = { target: "/payment/listedAmount" };', "game", "listed-cost-feedback"],
  ["§189 AP as action slots", G("runtime/compile.ts"), "export const actionSlots = 3;", "game", "ap-as-slots"],
  ["§190 action-name cost switch", G("runtime/compile.ts"), 'export const costOf = (actionKey: string) => { switch (actionKey) { case "MOVE": return 1; default: return 2; } };', "game", "action-cost-switch"],
  ["§190 action-name cost table", G("runtime/compile.ts"), "export const COSTS = { MOVE: 1, SPRINT: 3 };", "game", "action-cost-switch"],
  ["Resource-name branch", G("runtime/compile.ts"), 'export const refreshes = (key: string) => key === "AP";', "game", "resource-name-branch"],
  ["§191 players sorted into personal Initiative order", G("runtime/combat.ts"), "export const ordered = (members: string[]) => [...members].sort();", "game", "player-initiative-order"],
  ["§191 individual player Initiative slots", G("runtime/combat.ts"), "export const playerInitiative = new Map<string, number>();", "game", "player-initiative-order"],
  ["§192 hidden Initiative floor", G("runtime/combat.ts"), "export const half = (per: number) => Math.floor(per);", "game", "hidden-rounding"],
  ["§193 RNG Initiative reroll", G("runtime/combat.ts"), "export const reroll = (faces: number) => Math.random() * faces;", "game", "randomness"],
  ["runtime persistence", G("runtime/results.ts"), "export const persistResources = (value: unknown) => value;", "game", "persistence"],
  ["database import in the runtime layer", G("runtime/results.ts"), 'import { prisma } from "@prowess/db";', "game", "persistence"],
  ["latest / current Resource definition", G("runtime/definitions.ts"), "export const pick = (defs: unknown[]) => getCurrentResource(defs);", "game", "latest-or-current"],
  ["Prowess Counter Action inside M4", "packages/prowess-rules/src/resource/payment.ts", 'export const COUNTER = "counter_action";', "rules", "prowess-in-m4"],
  ["Prowess Initiative inside M4", "packages/prowess-rules/src/formula/evaluate.ts", "export const initiativeOrder = 1;", "rules", "prowess-in-m4"],
];

type Docs = { core: Doc; runtime: Doc };
const mutate = (fn: (d: Docs) => void): Docs => {
  const d = { core: core(), runtime: runtime() };
  fn(d);
  return d;
};
const res = (d: Docs, key: string) => d.runtime.definitions.find((x) => x.payload.resourceKey === key)!.payload;
const act = (d: Docs, key: string) => d.runtime.definitions.find((x) => x.payload.actionKey === key)!.payload;
const contentControls: Array<[string, () => Docs, string]> = [
  ["§175 Base Movement = 10 × AGI", () => mutate((d) => void ((d.core.definitions.find((x) => x.payload.statistic === "BASE_MOVEMENT")!.payload.formula as { expression: string }).expression = "10 * agi")), "movement-not-canonical"],
  ["§176 Large Size Base Movement drifts from the M5-SC-033 ruling (M5-I152)", () => mutate((d) => void (d.runtime.definitions.find((x) => x.payload.sizeKey === "LARGE")!.payload.baseMovement = { feet: 20 })), "size-speed-inference"],
  ["M5-I154 Massive Base Movement drifts from the M5-SC-036 ruling (40 ft)", () => mutate((d) => void (d.runtime.definitions.find((x) => x.payload.sizeKey === "MASSIVE")!.payload.baseMovement = { feet: 20 })), "size-speed-inference"],
  ["§176 Movement reads a Size term", () => mutate((d) => void ((d.core.definitions.find((x) => x.payload.statistic === "MOVEMENT")!.payload.formula as { variables: unknown[] }).variables.push({ variable: "size", source: { kind: "DERIVED", statistic: "STRENGTH_ARMOR" } }))), "size-speed-inference"],
  ["§177 DOUBLE_ADVANTAGE in content", () => mutate((d) => void ((d.core.definitions.find((x) => x.payload.procedure === "INITIATIVE")!.payload.naturalSelection as Record<string, unknown>).DOUBLE_ADVANTAGE = { expression: "max(r1, r2)" })), "advantage-stacking"],
  ["§181 AP carries over (no END_OF_TURN expiry)", () => mutate((d) => void (res(d, "AP").expiry = [])), "ap-banking"],
  ["§182 Counter Actions accumulate (restorable, no refresh)", () => mutate((d) => {
    const c = res(d, "COUNTER_ACTION");
    c.refresh = [];
    c.restoration = { ceiling: "NOMINAL_MAXIMUM", overflow: "CLAMP" };
  }), "counter-banking"],
  ["§183 ME does not refresh", () => mutate((d) => void (res(d, "ME").refresh = [])), "me-refresh"],
  ["§185 MP before ME", () => mutate((d) => {
    res(d, "ME").payment = [{ policy: "ME_ELIGIBLE_MAGICAL_COST", order: 1 }];
    res(d, "MP").payment = [{ policy: "MAGICAL_COST", order: 0 }, { policy: "ME_ELIGIBLE_MAGICAL_COST", order: 0 }];
  }), "mp-before-me"],
  ["ME pays a cost not declared ME-eligible", () => mutate((d) => void (res(d, "ME").payment = [{ policy: "ME_ELIGIBLE_MAGICAL_COST", order: 0 }, { policy: "MAGICAL_COST", order: 1 }])), "me-eligibility-assumed"],
  ["HP refreshes each Round", () => mutate((d) => void (res(d, "HP").refresh = [{ timing: "START_OF_ROUND", target: "TO_NOMINAL_MAXIMUM" }])), "hp-mp-auto-refresh"],
  ["AP reserves capacity", () => mutate((d) => void (res(d, "AP").supportsReservation = true)), "reservation-boundary"],
  ["Counter Action paid with AP", () => mutate((d) => void ((res(d, "AP").payment as unknown[]).push({ policy: "COUNTER_ACTION_COST", order: 1 }))), "counter-ap-interchange"],
  ["Heavy Attack costs 2 in content", () => mutate((d) => void (act(d, "HEAVY_ATTACK").actionPointCost = { model: "FIXED", amount: 2 })), "action-cost"],
  ["Sprint compounds (×16)", () => mutate((d) => void ((act(d, "SPRINT").movementGrant as { formula: { expression: string } }).formula.expression = "movement * 4 * 4")), "movement-grant"],
  ["Difficult Terrain at normal cost", () => mutate((d) => void ((d.runtime.definitions.find((x) => x.payload.terrainKey === "DIFFICULT")!.payload.allowanceCost as { expression: string }).expression = "distance")), "difficult-terrain"],
  ["§192 Initiative floors PER / 2 and AGI / 2", () => mutate((d) => void ((d.core.definitions.find((x) => x.payload.procedure === "INITIATIVE")!.payload.total as { expression: string }).expression = "natural + floor(per / 2) + floor(agi / 2) + bonuses")), "initiative-rounding"],
  ["Initiative ties skip PER", () => mutate((d) => void (d.core.definitions.find((x) => x.payload.procedure === "INITIATIVE")!.payload.tiebreak = [{ kind: "HIGHEST_STAT", stat: "AGI" }, { kind: "REROLL" }])), "initiative-tiebreak"],
  ["§194 Surprise restricts AP", () => mutate((d) => void (res(d, "AP").usageRestrictions = [{ restrictionKey: "SURPRISED", throughRound: 1 }])), "surprise-ap-penalty"],
  ["Surprise rule removed from Counter Action", () => mutate((d) => void (res(d, "COUNTER_ACTION").usageRestrictions = [])), "surprise-rule"],
];

describe("M5-WO3 permanent negative controls — mutated real source and content snapshots", () => {
  it.each(sourceControls)("%s is caught", (_label, file, snippet, layer, finding) => {
    expect(auditWo3Source(read(file), file, layer)).toEqual([]);
    expect(auditWo3Source(`${read(file)}\n${snippet}\n`, file, layer)).toContain(finding);
  });

  it.each(contentControls)("%s is caught in content", (_label, build, finding) => {
    expect(auditWo3Content(core(), runtime())).toEqual([]);
    const d = build();
    expect(auditWo3Content(d.core, d.runtime)).toContain(finding);
  });

  it("documentation comments mentioning forbidden ideas are not findings (AST, not grep)", () => {
    const file = G("runtime/compile.ts");
    expect(auditWo3Source(`${read(file)}\n// 10 * agi; DOUBLE_ADVANTAGE; sizeMovement; Math.random(); case "MOVE"\n`, file, "game")).toEqual([]);
  });
});
